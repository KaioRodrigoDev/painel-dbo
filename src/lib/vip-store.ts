// Shared by server routes and the standalone daily job; never import in a client component.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { vipExpiry, type VipChange } from "./vip-rules.ts";
import { hasVipExpiryColumn } from "./vip-schema.ts";

// Contrato do MDBO (DboServer/Database/migrations/20261019_accounts_vip.sql):
//   accounts.vip, accounts.vip_expires_at (UTC, exclusivo; NULL = VIP permanente antigo)
//   vip_admin_operations: uma linha por operação, com request_id único.
// O servidor calcula o VIP efetivo sozinho (EffectiveVipLevel): VIP vencido já vale 0 no
// jogo, então a rotina de expiração daqui só limpa o banco -- não é ela que tira o VIP.

export class VipError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
type VipRow = RowDataPacket & { id: number; vip: number; vip_expires_at: Date | null };
const iso = (date: Date | null) => date?.toISOString() ?? null;
const sqlDate = (date: string | null) => date ? date.slice(0, 19).replace("T", " ") : null;

/** Mesma DDL da migração do MDBO; repetir não muda nada. */
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
    if (!columns.some(row => row.Field === "vip")) await c.query("ALTER TABLE accounts ADD COLUMN vip TINYINT UNSIGNED NOT NULL DEFAULT 0");
    if (!columns.some(row => row.Field === "vip_expires_at")) await c.query("ALTER TABLE accounts ADD COLUMN vip_expires_at DATETIME NULL DEFAULT NULL COMMENT 'UTC exclusive expiry; NULL preserves legacy permanent VIP'");
    const [indexes] = await c.query<RowDataPacket[]>("SHOW INDEX FROM accounts WHERE Key_name='idx_accounts_vip_expiry'");
    if (!indexes.length) await c.query("CREATE INDEX idx_accounts_vip_expiry ON accounts(vip,vip_expires_at)");
    await c.query(`CREATE TABLE IF NOT EXISTS vip_admin_operations (
      request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      account_id INT UNSIGNED NOT NULL,
      action VARCHAR(12) NOT NULL,
      payload VARCHAR(255) NOT NULL,
      old_level TINYINT UNSIGNED NOT NULL,
      new_level TINYINT UNSIGNED NOT NULL,
      old_expiry DATETIME NULL,
      new_expiry DATETIME NULL,
      created_at DATETIME NOT NULL
    ) ENGINE=InnoDB`);
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':vip-schema'))");
    c.release();
  }
}

/** payload guarda quem fez e o hash do pedido, para reconhecer uma repetição do mesmo envio. */
const payloadOf = (actor: string, hash: string) => JSON.stringify({ by: actor.slice(0, 64), hash });
function hashOfPayload(payload: string) {
  try { return (JSON.parse(payload) as { hash?: string }).hash ?? null; } catch { return null; }
}

async function audit(c: PoolConnection, row: VipRow, level: number, expiry: string | null, actor: string, operation: string, request: string, hash: string) {
  await c.execute(`INSERT INTO vip_admin_operations
    (request_id, account_id, action, payload, old_level, new_level, old_expiry, new_expiry, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
  [request.slice(0, 64), row.id, operation.slice(0, 12), payloadOf(actor, hash), row.vip, level, row.vip_expires_at, sqlDate(expiry)]);
}

export async function changeVip(pool: Pool, accountId: number, change: VipChange, actor: string) {
  if (!(await hasVipExpiryColumn(pool))) {
    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE accounts SET vip=? WHERE id=?",
      [change.level, accountId],
    );
    if (result.affectedRows === 0) throw new VipError("Conta não encontrada.", 404);
    return { level: change.level, expiresAt: null, vipExpirySupported: false };
  }
  const hash = createHash("sha256").update(JSON.stringify({ accountId, actor, ...change })).digest("hex");
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.execute<VipRow[]>("SELECT id, vip, vip_expires_at FROM accounts WHERE id=? FOR UPDATE", [accountId]);
    if (!rows[0]) throw new VipError("Conta não encontrada.", 404);
    const [existing] = await c.execute<RowDataPacket[]>("SELECT payload, new_level, new_expiry FROM vip_admin_operations WHERE request_id=?", [change.requestId]);
    if (existing.length) {
      if (hashOfPayload(String(existing[0].payload)) !== hash) throw new VipError("Identificador de operação já utilizado.", 409);
      await c.commit();
      return { level: Number(existing[0].new_level), expiresAt: iso(existing[0].new_expiry), vipExpirySupported: true };
    }
    const [clock] = await c.query<RowDataPacket[]>("SELECT UTC_TIMESTAMP() now");
    let expiry: string | null;
    try { expiry = vipExpiry(change, iso(rows[0].vip_expires_at), clock[0].now); }
    catch (error) { throw new VipError(error instanceof Error ? error.message : "Validade inválida."); }
    await c.execute("UPDATE accounts SET vip=?, vip_expires_at=? WHERE id=?", [change.level, sqlDate(expiry), accountId]);
    await audit(c, rows[0], change.level, expiry, actor, change.operation, change.requestId, hash);
    await c.commit();
    return { level: change.level, expiresAt: expiry, vipExpirySupported: true };
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}

/**
 * Zera no banco os VIPs já vencidos. Opcional no MDBO: o jogo já trata vencido como sem VIP;
 * isto só deixa a coluna coerente para quem consulta o banco direto.
 */
export async function expireVip(pool: Pool, dryRun = false) {
  if (!(await hasVipExpiryColumn(pool))) {
    return { skipped: true, processed: 0, reason: "vip_expires_at_missing" };
  }
  const c = await pool.getConnection();
  const id = randomUUID();
  let locked = false;
  let processed = 0;
  try {
    const [lock] = await c.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':vip-expiry'), 0) acquired");
    if (lock[0].acquired !== 1) return { skipped: true, processed: 0 };
    locked = true;
    const [candidates] = await c.query<VipRow[]>("SELECT id FROM accounts WHERE vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP()");
    if (dryRun) return { dryRun: true, candidates: candidates.map(row => row.id), processed: 0 };
    for (const candidate of candidates) {
      await c.beginTransaction();
      const [rows] = await c.execute<VipRow[]>("SELECT id, vip, vip_expires_at FROM accounts WHERE id=? AND vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP() FOR UPDATE", [candidate.id]);
      if (rows[0]) {
        await c.execute("UPDATE accounts SET vip=0, vip_expires_at=NULL WHERE id=?", [candidate.id]);
        await audit(c, rows[0], 0, null, "daily-job", "expire", `exp-${id}-${candidate.id}`, "0".repeat(64));
      }
      await c.commit();
      if (rows[0]) processed++;
    }
    return { id, processed };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':vip-expiry'))").catch(() => {});
    c.release();
  }
}

export async function vipOverview(accounts: Pool, characters: Pool) {
  const vipExpirySupported = await hasVipExpiryColumn(accounts);
  const charactersQuery = "SELECT COUNT(*) totalCharacters, SUM(is_online=1) onlineCharacters, COUNT(DISTINCT CASE WHEN is_online=1 THEN account_id END) onlineAccounts FROM characters";
  if (!vipExpirySupported) {
    const [accountResult, characterResult] = await Promise.all([
      accounts.query<RowDataPacket[]>(`SELECT COUNT(*) totalAccounts,
        SUM(vip BETWEEN 1 AND 3) activeVip,
        0 legacyVip,
        0 expiredVip, 0 expiringVip,
        SUM(vip=1) vip1, SUM(vip=2) vip2, SUM(vip=3) vip3,
        SUM(vip NOT IN (0,1,2,3)) invalidVip FROM accounts`),
      characters.query<RowDataPacket[]>(charactersQuery),
    ]);
    const totals = Object.fromEntries(Object.entries({ ...accountResult[0][0], ...characterResult[0][0] }).map(([key, value]) => [key, Number(value ?? 0)]));
    return { totals, upcoming: [], lastRun: null, vipExpirySupported, updatedAt: new Date().toISOString() };
  }
  const active = "vip BETWEEN 1 AND 3 AND vip_expires_at > UTC_TIMESTAMP()";
  const [accountResult, characterResult, upcomingResult] = await Promise.all([
    accounts.query<RowDataPacket[]>(`SELECT COUNT(*) totalAccounts,
      SUM(${active}) activeVip,
      SUM(vip BETWEEN 1 AND 3 AND vip_expires_at IS NULL) legacyVip,
      SUM(vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP()) expiredVip,
      SUM(${active} AND vip_expires_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY)) expiringVip,
      SUM(${active} AND vip=1) vip1, SUM(${active} AND vip=2) vip2, SUM(${active} AND vip=3) vip3,
      SUM(vip NOT IN (0,1,2,3)) invalidVip FROM accounts`),
    characters.query<RowDataPacket[]>(charactersQuery),
    accounts.query<RowDataPacket[]>(`SELECT id accountId, username, vip, vip_expires_at expiresAt FROM accounts WHERE ${active} ORDER BY vip_expires_at, id LIMIT 10`),
  ]);
  const totals = Object.fromEntries(Object.entries({ ...accountResult[0][0], ...characterResult[0][0] }).map(([key, value]) => [key, Number(value ?? 0)]));
  return { totals, upcoming: upcomingResult[0], lastRun: null, vipExpirySupported, updatedAt: new Date().toISOString() };
}
