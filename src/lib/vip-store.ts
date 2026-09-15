// Shared by server routes and the standalone daily job; never import in a client component.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { vipExpiry, type VipChange } from "./vip-rules.ts";
import { hasVipExpiryColumn } from "./vip-schema.ts";

export class VipError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
type VipRow = RowDataPacket & { AccountID: number; vip: number; vip_expires_at: Date | null };
const iso = (date: Date | null) => date?.toISOString() ?? null;
const sqlDate = (date: string | null) => date ? date.slice(0, 19).replace("T", " ") : null;

export async function migrateVip(pool: Pool) {
  const c = await pool.getConnection();
  let locked = false;
  try {
    const [lock] = await c.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':vip-schema'), 30) acquired");
    if (lock[0].acquired !== 1) throw new Error("Migração VIP ocupada.");
    locked = true;
    const [tables] = await c.query<RowDataPacket[]>("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts'");
    if (tables[0]?.ENGINE !== "InnoDB") throw new Error("A gestão VIP exige accounts em InnoDB para transações seguras. Confira o schema antes da migração.");
    const [columns] = await c.query<RowDataPacket[]>("SHOW COLUMNS FROM accounts");
    if (!columns.some(row => row.Field === "vip")) throw new Error("Coluna accounts.vip não encontrada.");
    if (!columns.some(row => row.Field === "vip_expires_at")) await c.query("ALTER TABLE accounts ADD COLUMN vip_expires_at DATETIME NULL");
    const [indexes] = await c.query<RowDataPacket[]>("SHOW INDEX FROM accounts WHERE Key_name='idx_admin_vip_expiry'");
    if (!indexes.length) await c.query("ALTER TABLE accounts ADD INDEX idx_admin_vip_expiry (vip, vip_expires_at)");
    await c.query(`CREATE TABLE IF NOT EXISTS admin_vip_audit (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, request_id VARCHAR(100) NOT NULL UNIQUE,
      account_id INT UNSIGNED NOT NULL, actor VARCHAR(64) NOT NULL, operation VARCHAR(16) NOT NULL,
      payload_hash CHAR(64) NOT NULL, old_level INT NOT NULL, new_level INT NOT NULL,
      old_expiry DATETIME NULL, new_expiry DATETIME NULL, created_at DATETIME NOT NULL,
      KEY idx_vip_audit_account (account_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await c.query(`CREATE TABLE IF NOT EXISTS admin_vip_runs (
      id CHAR(36) PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
      status VARCHAR(16) NOT NULL, processed INT NOT NULL DEFAULT 0, error_message VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':vip-schema'))");
    c.release();
  }
}

async function audit(c: PoolConnection, row: VipRow, level: number, expiry: string | null, actor: string, operation: string, request: string, hash: string) {
  await c.execute(`INSERT INTO admin_vip_audit
    (request_id, account_id, actor, operation, payload_hash, old_level, new_level, old_expiry, new_expiry, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
  [request, row.AccountID, actor.slice(0, 64), operation, hash, row.vip, level, row.vip_expires_at, sqlDate(expiry)]);
}

export async function changeVip(pool: Pool, accountId: number, change: VipChange, actor: string) {
  if (!(await hasVipExpiryColumn(pool))) {
    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE accounts SET vip=? WHERE AccountID=?",
      [change.level, accountId],
    );
    if (result.affectedRows === 0) throw new VipError("Conta não encontrada.", 404);
    return { level: change.level, expiresAt: null, vipExpirySupported: false };
  }
  const hash = createHash("sha256").update(JSON.stringify({ accountId, actor, ...change })).digest("hex");
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.execute<VipRow[]>("SELECT AccountID, vip, vip_expires_at FROM accounts WHERE AccountID=? FOR UPDATE", [accountId]);
    if (!rows[0]) throw new VipError("Conta não encontrada.", 404);
    const [existing] = await c.execute<RowDataPacket[]>("SELECT payload_hash, new_level, new_expiry FROM admin_vip_audit WHERE request_id=?", [change.requestId]);
    if (existing.length) {
      if (existing[0].payload_hash !== hash) throw new VipError("Identificador de operação já utilizado.", 409);
      await c.commit();
      return { level: Number(existing[0].new_level), expiresAt: iso(existing[0].new_expiry), vipExpirySupported: true };
    }
    const [clock] = await c.query<RowDataPacket[]>("SELECT UTC_TIMESTAMP() now");
    let expiry: string | null;
    try { expiry = vipExpiry(change, iso(rows[0].vip_expires_at), clock[0].now); }
    catch (error) { throw new VipError(error instanceof Error ? error.message : "Validade inválida."); }
    await c.execute("UPDATE accounts SET vip=?, vip_expires_at=? WHERE AccountID=?", [change.level, sqlDate(expiry), accountId]);
    await audit(c, rows[0], change.level, expiry, actor, change.operation, change.requestId, hash);
    await c.commit();
    return { level: change.level, expiresAt: expiry, vipExpirySupported: true };
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}

export async function expireVip(pool: Pool, dryRun = false) {
  if (!(await hasVipExpiryColumn(pool))) {
    return { skipped: true, processed: 0, reason: "vip_expires_at_missing" };
  }
  const c = await pool.getConnection();
  const id = randomUUID();
  let locked = false;
  let started = false;
  let processed = 0;
  try {
    const [lock] = await c.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':vip-expiry'), 0) acquired");
    if (lock[0].acquired !== 1) return { skipped: true, processed: 0 };
    locked = true;
    const [candidates] = await c.query<VipRow[]>("SELECT AccountID FROM accounts WHERE vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP()");
    if (dryRun) return { dryRun: true, candidates: candidates.map(row => row.AccountID), processed: 0 };
    await c.query("UPDATE admin_vip_runs SET status='failed', finished_at=UTC_TIMESTAMP(), error_message='Execução interrompida' WHERE status='running'");
    await c.execute("INSERT INTO admin_vip_runs (id, started_at, status) VALUES (?, UTC_TIMESTAMP(), 'running')", [id]);
    started = true;
    for (const candidate of candidates) {
      await c.beginTransaction();
      const [rows] = await c.execute<VipRow[]>("SELECT AccountID, vip, vip_expires_at FROM accounts WHERE AccountID=? AND vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP() FOR UPDATE", [candidate.AccountID]);
      if (rows[0]) {
        await c.execute("UPDATE accounts SET vip=0, vip_expires_at=NULL WHERE AccountID=?", [candidate.AccountID]);
        await audit(c, rows[0], 0, null, "daily-job", "expire", `${id}:${candidate.AccountID}`, "0".repeat(64));
        await c.execute("UPDATE admin_vip_runs SET processed=processed+1 WHERE id=?", [id]);
      }
      await c.commit();
      if (rows[0]) processed++;
    }
    await c.execute("UPDATE admin_vip_runs SET status='success', finished_at=UTC_TIMESTAMP() WHERE id=?", [id]);
    return { id, processed };
  } catch (error) {
    await c.rollback();
    if (started) await c.execute("UPDATE admin_vip_runs SET status='failed', finished_at=UTC_TIMESTAMP(), error_message='Falha ao processar vencimentos; consulte o log do agendador' WHERE id=?", [id]).catch(() => {});
    throw error;
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':vip-expiry'))").catch(() => {});
    c.release();
  }
}

export async function vipOverview(accounts: Pool, characters: Pool) {
  const vipExpirySupported = await hasVipExpiryColumn(accounts);
  if (!vipExpirySupported) {
    const [accountResult, characterResult] = await Promise.all([
      accounts.query<RowDataPacket[]>(`SELECT COUNT(*) totalAccounts,
        SUM(vip BETWEEN 1 AND 3) activeVip,
        0 legacyVip,
        0 expiredVip, 0 expiringVip,
        SUM(vip=1) vip1, SUM(vip=2) vip2, SUM(vip=3) vip3,
        SUM(vip NOT IN (0,1,2,3)) invalidVip FROM accounts`),
      characters.query<RowDataPacket[]>("SELECT COUNT(*) totalCharacters, SUM(is_online=1) onlineCharacters, COUNT(DISTINCT CASE WHEN is_online=1 THEN AccountID END) onlineAccounts FROM characters"),
    ]);
    const totals = Object.fromEntries(Object.entries({ ...accountResult[0][0], ...characterResult[0][0] }).map(([key, value]) => [key, Number(value ?? 0)]));
    return { totals, upcoming: [], lastRun: null, vipExpirySupported, updatedAt: new Date().toISOString() };
  }
  const active = "vip BETWEEN 1 AND 3 AND vip_expires_at > UTC_TIMESTAMP()";
  const [accountResult, characterResult, upcomingResult, runResult] = await Promise.all([
    accounts.query<RowDataPacket[]>(`SELECT COUNT(*) totalAccounts,
      SUM(${active}) activeVip,
      SUM(vip BETWEEN 1 AND 3 AND vip_expires_at IS NULL) legacyVip,
      SUM(vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP()) expiredVip,
      SUM(${active} AND vip_expires_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY)) expiringVip,
      SUM(${active} AND vip=1) vip1, SUM(${active} AND vip=2) vip2, SUM(${active} AND vip=3) vip3,
      SUM(vip NOT IN (0,1,2,3)) invalidVip FROM accounts`),
    characters.query<RowDataPacket[]>("SELECT COUNT(*) totalCharacters, SUM(is_online=1) onlineCharacters, COUNT(DISTINCT CASE WHEN is_online=1 THEN AccountID END) onlineAccounts FROM characters"),
    accounts.query<RowDataPacket[]>(`SELECT AccountID accountId, Username username, vip, vip_expires_at expiresAt FROM accounts WHERE ${active} ORDER BY vip_expires_at, AccountID LIMIT 10`),
    accounts.query<RowDataPacket[]>("SELECT id, started_at startedAt, finished_at finishedAt, status, processed, error_message error FROM admin_vip_runs ORDER BY started_at DESC LIMIT 1"),
  ]);
  const totals = Object.fromEntries(Object.entries({ ...accountResult[0][0], ...characterResult[0][0] }).map(([key, value]) => [key, Number(value ?? 0)]));
  return { totals, upcoming: upcomingResult[0], lastRun: runResult[0][0] ?? null, vipExpirySupported, updatedAt: new Date().toISOString() };
}
