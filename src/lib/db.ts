import "server-only";

import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

import {
  getAccountDatabaseConfig,
  getAdminConfig,
  getCharacterDatabaseConfig,
  getGameQueues,
} from "@/lib/env";
import type {
  AccountSummary,
  AccountsResponse,
  CharacterSummary,
  EditableCharacterFields,
} from "@/lib/types";
import { hasVipExpiryColumn } from "@/lib/vip-schema";

// Colunas do banco do MDBO (mdbo_acc / mdbo_char), em snake_case:
// accounts.id/username/is_gm e characters.id/char_name/account_id/sp_point/game_master.
// O banco antigo do DBO World usava AccountID, CharID, CharName... -- nao misturar.
// As tabelas admin_* sao do proprio painel e mantem os nomes com que foram criadas.

declare global {
  var __dbowAccountPool: Pool | undefined;
  var __dbowCharacterPool: Pool | undefined;
  var __dbowAdminSchemaPromise: Promise<void> | undefined;
}

function createDatabasePool(config: ReturnType<typeof getAccountDatabaseConfig>) {
  return mysql.createPool({
    ...config,
    connectionLimit: 5,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: "latin1",
    timezone: "Z",
    decimalNumbers: true,
  });
}

export function getAccountPool() {
  global.__dbowAccountPool ??= createDatabasePool(getAccountDatabaseConfig());
  return global.__dbowAccountPool;
}

export function getCharacterPool() {
  global.__dbowCharacterPool ??= createDatabasePool(
    getCharacterDatabaseConfig(),
  );
  return global.__dbowCharacterPool;
}

/** Erro de regra (fila desligada, limite...) que a rota devolve com a mensagem e o status. */
export class AdminActionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export const QUEUE_DISABLED_MESSAGE = {
  character: "Edição de personagem desligada. Ligue MDBO_ADMIN_QUEUES=character no .env.local; o QueryServer precisa ser a versão com AdminCharacterUpdateQueue, que lê admin_character_updates.",
  mail: "O QueryServer do MDBO ainda não entrega itens enviados pelo painel por correio. Ligue MDBO_ADMIN_QUEUES=mail no .env.local quando o servidor passar a ler admin_mail_items.",
  cashshop: "O QueryServer do MDBO ainda não entrega itens enviados pelo painel ao Cash Shop. Ligue MDBO_ADMIN_QUEUES=cashshop no .env.local quando o servidor passar a ler admin_cashshop_items.",
};

type AccountRow = RowDataPacket & {
  vip: number;
  vip_expires_at: Date | null;
  id: number;
  username: string;
  acc_status: "pending" | "block" | "active";
  email: string;
  admin: number;
  is_gm: number;
  mallpoints: number;
  reg_date: Date | null;
  last_login: Date | null;
};

type CharacterRow = RowDataPacket & {
  id: number;
  account_id: number;
  char_name: string;
  level: number;
  exp: number;
  sp_point: number;
  money: number;
  race: number | null;
  class: number | null;
  gender: number | null;
  adult: number;
  game_master: number;
  is_online: number;
  PendingUpdateId?: number | null;
  PendingStatus?: "pending" | "waiting_logout" | null;
  PendingLevel?: number | null;
  PendingExp?: number | null;
  PendingSpPoint?: number | null;
  PendingMoney?: number | null;
  PendingCash?: number | null;
  PendingCreatedAt?: Date | null;
};

const CHARACTER_COLUMNS = `c.id, c.account_id, c.char_name, c.level, c.exp, c.sp_point, c.money,
  c.race, c.class, c.gender, c.adult, c.game_master, c.is_online`;

async function addMissingColumns(pool: Pool, table: string, definitions: Record<string, string>) {
  const [rows] = await pool.query<(RowDataPacket & { COLUMN_NAME: string })[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table]);
  const existing = new Set(rows.map((row) => row.COLUMN_NAME.toLowerCase()));
  for (const [column, definition] of Object.entries(definitions)) {
    if (!existing.has(column.toLowerCase())) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Cria só as tabelas das filas ligadas: as desligadas não deixam tabela órfã no banco do jogo. */
async function createOrMigrateAdminSchema() {
  const pool = getCharacterPool();
  const accountPool = getAccountPool();
  const queues = getGameQueues();

  if (queues.characterEdits) {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_character_updates (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      CharID INT UNSIGNED NOT NULL,
      AccountID INT UNSIGNED NOT NULL,
      Level TINYINT UNSIGNED NOT NULL,
      Exp INT UNSIGNED NOT NULL,
      SpPoint INT UNSIGNED NOT NULL,
      Money INT UNSIGNED NOT NULL,
      Cash INT UNSIGNED NOT NULL DEFAULT 0,
      old_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
      old_exp INT UNSIGNED NOT NULL DEFAULT 0,
      old_sp_point INT UNSIGNED NOT NULL DEFAULT 0,
      old_money INT UNSIGNED NOT NULL DEFAULT 0,
      old_cash INT UNSIGNED NOT NULL DEFAULT 0,
      Status VARCHAR(24) NOT NULL DEFAULT 'pending',
      RequestedBy VARCHAR(64) NOT NULL,
      ErrorMessage VARCHAR(255) NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (Id),
      KEY idx_admin_updates_status (Status, Id),
      KEY idx_admin_updates_character (CharID, Status)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await addMissingColumns(pool, "admin_character_updates", {
      Cash: "INT UNSIGNED NOT NULL DEFAULT 0",
      old_level: "TINYINT UNSIGNED NOT NULL DEFAULT 1",
      old_exp: "INT UNSIGNED NOT NULL DEFAULT 0",
      old_sp_point: "INT UNSIGNED NOT NULL DEFAULT 0",
      old_money: "INT UNSIGNED NOT NULL DEFAULT 0",
      old_cash: "INT UNSIGNED NOT NULL DEFAULT 0",
    });
  }

  if (queues.mail) {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_items (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, RequestKey CHAR(36) NOT NULL,
      AccountID INT UNSIGNED NOT NULL, CharID INT UNSIGNED NOT NULL,
      ItemTblidx INT UNSIGNED NOT NULL, ItemName VARCHAR(100) NOT NULL,
      StackCount TINYINT UNSIGNED NOT NULL, ItemRank TINYINT UNSIGNED NOT NULL,
      Durability TINYINT UNSIGNED NOT NULL, BattleAttribute TINYINT UNSIGNED NOT NULL,
      OptionTblidx INT UNSIGNED NOT NULL, DurationType TINYINT UNSIGNED NOT NULL,
      UseDurationMax INT UNSIGNED NOT NULL, Message VARCHAR(127) NOT NULL,
      RequestedBy VARCHAR(64) NOT NULL, SealItem TINYINT UNSIGNED NOT NULL DEFAULT 0,
      Status VARCHAR(24) NOT NULL DEFAULT 'pending',
      ItemID BIGINT UNSIGNED NULL, MailID INT UNSIGNED NULL, ErrorMessage VARCHAR(255) NULL,
      ClaimedAt TIMESTAMP NULL, ClaimedByCharID INT UNSIGNED NULL,
      ClaimedPlace TINYINT UNSIGNED NULL, ClaimedPos TINYINT UNSIGNED NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_request (RequestKey),
      KEY idx_admin_mail_status (Status, Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await addMissingColumns(pool, "admin_mail_items", {
      SealItem: "TINYINT UNSIGNED NOT NULL DEFAULT 0",
      ClaimedAt: "TIMESTAMP NULL",
      ClaimedByCharID: "INT UNSIGNED NULL",
      ClaimedPlace: "TINYINT UNSIGNED NULL",
      ClaimedPos: "TINYINT UNSIGNED NULL",
    });
    // No MDBO a coluna é mail.is_accept; com IsAccept esta instrução falhava e derrubava
    // a lista de contas inteira, que depende desta preparação.
    await pool.query(`UPDATE admin_mail_items q INNER JOIN mail m ON m.id=q.MailID
      SET q.Status='claimed',q.ClaimedByCharID=COALESCE(q.ClaimedByCharID,q.CharID)
      WHERE m.is_accept=1 AND q.Status='applied'`);

    await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_batches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, BatchKey CHAR(36) NOT NULL,
      VipLevel TINYINT UNSIGNED NOT NULL, ItemTblidx INT UNSIGNED NOT NULL,
      ItemName VARCHAR(100) NOT NULL, StackCount TINYINT UNSIGNED NOT NULL,
      Message VARCHAR(127) NOT NULL, RequestedBy VARCHAR(64) NOT NULL,
      SealItem TINYINT UNSIGNED NOT NULL DEFAULT 0,
      RecipientCount INT UNSIGNED NOT NULL DEFAULT 0, SkippedCount INT UNSIGNED NOT NULL DEFAULT 0,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_batch (BatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await addMissingColumns(pool, "admin_mail_batches", { SealItem: "TINYINT UNSIGNED NOT NULL DEFAULT 0" });

    await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_recipient_preferences (
      AccountID INT UNSIGNED NOT NULL PRIMARY KEY,
      CharID INT UNSIGNED NOT NULL,
      UpdatedBy VARCHAR(64) NOT NULL,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);

    await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_package_dispatches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, DispatchKey CHAR(36) NOT NULL,
      PackageID CHAR(36) NOT NULL, Signature CHAR(64) NOT NULL,
      RecipientCount INT UNSIGNED NOT NULL, ItemCount INT UNSIGNED NOT NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_package_dispatch (DispatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
  }

  if (queues.cashShop) {
    await accountPool.query(`CREATE TABLE IF NOT EXISTS admin_cashshop_items (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      RequestKey CHAR(36) NOT NULL,
      AccountID INT UNSIGNED NOT NULL,
      ItemTblidx INT UNSIGNED NOT NULL,
      HLSitemTblidx INT UNSIGNED NOT NULL,
      ItemName VARCHAR(100) NOT NULL,
      StackCount TINYINT UNSIGNED NOT NULL DEFAULT 1,
      RequestedBy VARCHAR(64) NOT NULL,
      Status VARCHAR(24) NOT NULL DEFAULT 'pending',
      ProductID BIGINT UNSIGNED NULL,
      ErrorMessage VARCHAR(255) NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_cashshop_request (RequestKey),
      KEY idx_admin_cashshop_status (Status, Id), KEY idx_admin_cashshop_account (AccountID, Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);

    await accountPool.query(`CREATE TABLE IF NOT EXISTS admin_cashshop_batches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      BatchKey CHAR(36) NOT NULL,
      VipLevel TINYINT UNSIGNED NOT NULL,
      ItemTblidx INT UNSIGNED NOT NULL,
      HLSitemTblidx INT UNSIGNED NOT NULL,
      ItemName VARCHAR(100) NOT NULL,
      StackCount TINYINT UNSIGNED NOT NULL,
      RequestedBy VARCHAR(64) NOT NULL,
      RecipientCount INT UNSIGNED NOT NULL DEFAULT 0,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_cashshop_batch (BatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
  }
}

export async function ensureAdminSchema() {
  global.__dbowAdminSchemaPromise ??= createOrMigrateAdminSchema().catch((error) => {
    global.__dbowAdminSchemaPromise = undefined;
    throw error;
  });
  return global.__dbowAdminSchemaPromise;
}

/** Tabela do painel que pode não existir (fila desligada ou nunca usada). */
export async function tableExists(pool: Pool, table: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1", [table]);
  return rows.length > 0;
}

function toCharacterDto(row: CharacterRow): CharacterSummary {
  return {
    charId: row.id,
    accountId: row.account_id,
    name: row.char_name,
    level: row.level,
    experience: row.exp,
    skillPoints: row.sp_point,
    money: row.money,
    race: row.race,
    characterClass: row.class,
    gender: row.gender,
    adult: Boolean(row.adult),
    gameMaster: Boolean(row.game_master),
    online: Boolean(row.is_online),
    pendingUpdate: row.PendingUpdateId && row.PendingStatus ? {
      id: row.PendingUpdateId,
      status: row.PendingStatus,
      level: Number(row.PendingLevel),
      experience: Number(row.PendingExp),
      skillPoints: Number(row.PendingSpPoint),
      money: Number(row.PendingMoney),
      cash: Number(row.PendingCash),
      requestedAt: row.PendingCreatedAt?.toISOString() ?? new Date(0).toISOString(),
    } : null,
  };
}

export async function listAccounts(options: {
  vipLevel?: string;
  vipState?: string;
  search: string;
  page: number;
  pageSize: number;
}): Promise<AccountsResponse> {
  await ensureAdminSchema();
  const { search, page, pageSize } = options;
  const offset = (page - 1) * pageSize;
  const term = `%${search}%`;
  const accountPool = getAccountPool();
  const characterPool = getCharacterPool();
  const vipExpirySupported = await hasVipExpiryColumn(accountPool);
  const queues = getGameQueues();

  const clauses: string[] = [];
  if (search) clauses.push("(username LIKE ? OR CAST(id AS CHAR) = ?)");
  const parameters = search ? [term, search] : [];
  if (options.vipLevel && options.vipLevel !== "all") {
    clauses.push("vip = ?"); parameters.push(options.vipLevel);
  }
  const states: Record<string, string> = vipExpirySupported ? {
    none: "vip = 0",
    active: "vip BETWEEN 1 AND 3 AND vip_expires_at > UTC_TIMESTAMP()",
    current: "vip BETWEEN 1 AND 3 AND (vip_expires_at > UTC_TIMESTAMP() OR vip_expires_at IS NULL)",
    legacy: "vip BETWEEN 1 AND 3 AND vip_expires_at IS NULL",
    expired: "vip BETWEEN 1 AND 3 AND vip_expires_at <= UTC_TIMESTAMP()",
    expiring: "vip BETWEEN 1 AND 3 AND vip_expires_at > UTC_TIMESTAMP() AND vip_expires_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY)",
    invalid: "vip NOT IN (0,1,2,3)",
  } : {
    none: "vip = 0",
    active: "vip BETWEEN 1 AND 3",
    current: "vip BETWEEN 1 AND 3",
    legacy: "vip BETWEEN 1 AND 3",
    expired: "1 = 0",
    expiring: "1 = 0",
    invalid: "vip NOT IN (0,1,2,3)",
  };
  if (options.vipState && states[options.vipState]) clauses.push(`(${states[options.vipState]})`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countRows] = await accountPool.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM accounts ${where}`,
    parameters,
  );

  const [accountRows] = await accountPool.execute<AccountRow[]>(
    `SELECT id, username, acc_status, email, admin, is_gm,
            mallpoints, reg_date, last_login, vip,
            ${vipExpirySupported ? "vip_expires_at" : "NULL AS vip_expires_at"}
       FROM accounts
       ${where}
      ORDER BY id DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    parameters,
  );

  const accountIds = accountRows.map((row) => row.id);
  let characterRows: CharacterRow[] = [];
  if (accountIds.length > 0) {
    const placeholders = accountIds.map(() => "?").join(",");
    // A pendência de edição só existe com a fila de personagem ligada.
    const withPending = queues.characterEdits && await tableExists(characterPool, "admin_character_updates");
    const [rows] = await characterPool.execute<CharacterRow[]>(
      withPending
        ? `SELECT ${CHARACTER_COLUMNS},
                  u.Id AS PendingUpdateId, u.Status AS PendingStatus,
                  u.Level AS PendingLevel, u.Exp AS PendingExp,
                  u.SpPoint AS PendingSpPoint, u.Money AS PendingMoney,
                  u.Cash AS PendingCash, u.CreatedAt AS PendingCreatedAt
             FROM characters c
             LEFT JOIN admin_character_updates u
               ON u.Id = (
                 SELECT MAX(active.Id) FROM admin_character_updates active
                  WHERE active.CharID = c.id
                    AND active.Status IN ('pending', 'waiting_logout')
               )
            WHERE c.account_id IN (${placeholders})
            ORDER BY c.account_id DESC, c.id ASC`
        : `SELECT ${CHARACTER_COLUMNS}
             FROM characters c
            WHERE c.account_id IN (${placeholders})
            ORDER BY c.account_id DESC, c.id ASC`,
      accountIds,
    );
    characterRows = rows;
  }

  const charactersByAccount = new Map<number, CharacterSummary[]>();
  for (const row of characterRows) {
    const entries = charactersByAccount.get(row.account_id) ?? [];
    entries.push(toCharacterDto(row));
    charactersByAccount.set(row.account_id, entries);
  }

  const total = Number(countRows[0]?.total ?? 0);
  const accounts: AccountSummary[] = accountRows.map((row) => ({
    vip: Number(row.vip),
    vipExpiresAt: row.vip_expires_at?.toISOString() ?? null,
    accountId: row.id,
    username: row.username,
    status: row.acc_status,
    email: row.email,
    adminLevel: row.admin,
    gameMaster: Boolean(row.is_gm),
    mallPoints: row.mallpoints,
    registeredAt: row.reg_date?.toISOString() ?? null,
    lastLogin: row.last_login?.toISOString() ?? null,
    characters: charactersByAccount.get(row.id) ?? [],
  }));

  return {
    accounts,
    vipExpirySupported,
    integrations: queues,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type CharacterUpdateResult =
  | {
      ok: true;
      character: CharacterSummary;
      previous: EditableCharacterFields;
      updateId: number;
    }
  | { ok: false; reason: "not_found" };

export async function requestCharacterUpdate(
  characterId: number,
  values: EditableCharacterFields,
  requestedBy: string,
): Promise<CharacterUpdateResult> {
  if (!getGameQueues().characterEdits) throw new AdminActionError(QUEUE_DISABLED_MESSAGE.character);
  await ensureAdminSchema();
  const connection = await getCharacterPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<CharacterRow[]>(
      `SELECT ${CHARACTER_COLUMNS}
         FROM characters c
        WHERE c.id = ?
        LIMIT 1
        FOR UPDATE`,
      [characterId],
    );

    const current = rows[0];
    if (!current) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }
    const [accountRows] = await getAccountPool().execute<(RowDataPacket & { mallpoints: number })[]>(
      "SELECT mallpoints FROM accounts WHERE id = ? LIMIT 1",
      [current.account_id],
    );
    const oldCash = accountRows[0]?.mallpoints;
    if (oldCash === undefined) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }
    const maxLevel = getAdminConfig().maxCharacterLevel;
    if (values.level > maxLevel) {
      throw new Error(`Level acima do limite configurado (${maxLevel})`);
    }

    await connection.execute(
      `UPDATE admin_character_updates
          SET Status = 'superseded', ErrorMessage = 'replaced by newer request'
        WHERE CharID = ? AND Status IN ('pending', 'waiting_logout')`,
      [characterId],
    );

    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO admin_character_updates
        (CharID, AccountID, Level, Exp, SpPoint, Money, Cash,
         old_level, old_exp, old_sp_point, old_money, old_cash,
         Status, RequestedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        characterId,
        current.account_id,
        values.level,
        values.experience,
        values.skillPoints,
        values.money,
        values.cash,
        current.level,
        current.exp,
        current.sp_point,
        current.money,
        oldCash,
        requestedBy.slice(0, 64),
      ],
    );

    await connection.commit();
    return {
      ok: true,
      previous: {
        level: current.level,
        experience: current.exp,
        skillPoints: current.sp_point,
        money: current.money,
        cash: oldCash,
      },
      updateId: insert.insertId,
      character: {
        ...toCharacterDto(current),
        pendingUpdate: {
          id: insert.insertId,
          status: "pending",
          ...values,
          requestedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function checkDatabaseConnections() {
  await Promise.all([
    getAccountPool().query("SELECT 1"),
    getCharacterPool().query("SELECT 1"),
  ]);
}
