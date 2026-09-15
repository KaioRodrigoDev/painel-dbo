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
} from "@/lib/env";
import type {
  AccountSummary,
  AccountsResponse,
  CharacterSummary,
  EditableCharacterFields,
} from "@/lib/types";
import { hasVipExpiryColumn } from "@/lib/vip-schema";

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

type AccountRow = RowDataPacket & {
  vip: number;
  vip_expires_at: Date | null;
  AccountID: number;
  Username: string;
  acc_status: "pending" | "block" | "active";
  email: string;
  admin: number;
  isGm: number;
  mallpoints: number;
  reg_date: Date | null;
  last_login: Date | null;
};

type CharacterRow = RowDataPacket & {
  CharID: number;
  AccountID: number;
  CharName: string;
  Level: number;
  Exp: number;
  SpPoint: number;
  Money: number;
  Race: number | null;
  Class: number | null;
  Gender: number | null;
  Adult: number;
  GameMaster: number;
  IsOnline: number;
  PendingUpdateId?: number | null;
  PendingStatus?: "pending" | "waiting_logout" | null;
  PendingLevel?: number | null;
  PendingExp?: number | null;
  PendingSpPoint?: number | null;
  PendingMoney?: number | null;
  PendingCash?: number | null;
  PendingCreatedAt?: Date | null;
};

async function createOrMigrateAdminSchema() {
  const pool = getCharacterPool();
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

  await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_items (
    Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    RequestKey CHAR(36) NOT NULL,
    AccountID INT UNSIGNED NOT NULL,
    CharID INT UNSIGNED NOT NULL,
    ItemTblidx INT UNSIGNED NOT NULL,
    ItemName VARCHAR(100) NOT NULL,
    StackCount TINYINT UNSIGNED NOT NULL DEFAULT 1,
    ItemRank TINYINT UNSIGNED NOT NULL DEFAULT 0,
    Durability TINYINT UNSIGNED NOT NULL DEFAULT 0,
    BattleAttribute TINYINT UNSIGNED NOT NULL DEFAULT 0,
    OptionTblidx INT UNSIGNED NOT NULL DEFAULT 4294967295,
    DurationType TINYINT UNSIGNED NOT NULL DEFAULT 0,
    UseDurationMax INT UNSIGNED NOT NULL DEFAULT 0,
    Message VARCHAR(127) NOT NULL,
    RequestedBy VARCHAR(64) NOT NULL,
    Status VARCHAR(24) NOT NULL DEFAULT 'pending',
    ItemID BIGINT UNSIGNED NULL,
    MailID INT UNSIGNED NULL,
    ErrorMessage VARCHAR(255) NULL,
    CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_request (RequestKey),
    KEY idx_admin_mail_status (Status, Id), KEY idx_admin_mail_character (CharID, Id)
  ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);

  await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_batches (
    Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    BatchKey CHAR(36) NOT NULL,
    VipLevel TINYINT UNSIGNED NOT NULL,
    ItemTblidx INT UNSIGNED NOT NULL,
    ItemName VARCHAR(100) NOT NULL,
    StackCount TINYINT UNSIGNED NOT NULL,
    Message VARCHAR(127) NOT NULL,
    RequestedBy VARCHAR(64) NOT NULL,
    RecipientCount INT UNSIGNED NOT NULL DEFAULT 0,
    SkippedCount INT UNSIGNED NOT NULL DEFAULT 0,
    CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_batch (BatchKey)
  ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);

  const definitions: Record<string, string> = {
    Cash: "INT UNSIGNED NOT NULL DEFAULT 0",
    old_level: "TINYINT UNSIGNED NOT NULL DEFAULT 1",
    old_exp: "INT UNSIGNED NOT NULL DEFAULT 0",
    old_sp_point: "INT UNSIGNED NOT NULL DEFAULT 0",
    old_money: "INT UNSIGNED NOT NULL DEFAULT 0",
    old_cash: "INT UNSIGNED NOT NULL DEFAULT 0",
  };
  const [rows] = await pool.query<(RowDataPacket & { COLUMN_NAME: string })[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_character_updates'`,
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME.toLowerCase()));
  for (const [column, definition] of Object.entries(definitions)) {
    if (!existing.has(column.toLowerCase())) {
      await pool.query(`ALTER TABLE admin_character_updates ADD COLUMN ${column} ${definition}`);
    }
  }
}

export async function ensureAdminSchema() {
  global.__dbowAdminSchemaPromise ??= createOrMigrateAdminSchema().catch((error) => {
    global.__dbowAdminSchemaPromise = undefined;
    throw error;
  });
  return global.__dbowAdminSchemaPromise;
}

function toCharacterDto(row: CharacterRow): CharacterSummary {
  return {
    charId: row.CharID,
    accountId: row.AccountID,
    name: row.CharName,
    level: row.Level,
    experience: row.Exp,
    skillPoints: row.SpPoint,
    money: row.Money,
    race: row.Race,
    characterClass: row.Class,
    gender: row.Gender,
    adult: Boolean(row.Adult),
    gameMaster: Boolean(row.GameMaster),
    online: Boolean(row.IsOnline),
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
  const vipExpirySupported = await hasVipExpiryColumn(accountPool);

  const clauses: string[] = [];
  if (search) clauses.push("(Username LIKE ? OR CAST(AccountID AS CHAR) = ?)");
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
    `SELECT AccountID, Username, acc_status, email, admin, isGm,
            mallpoints, reg_date, last_login, vip,
            ${vipExpirySupported ? "vip_expires_at" : "NULL AS vip_expires_at"}
       FROM accounts
       ${where}
      ORDER BY AccountID DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    parameters,
  );

  const accountIds = accountRows.map((row) => row.AccountID);
  let characterRows: CharacterRow[] = [];
  if (accountIds.length > 0) {
    const placeholders = accountIds.map(() => "?").join(",");
    const [rows] = await getCharacterPool().execute<CharacterRow[]>(
      `SELECT c.CharID, c.AccountID, c.CharName, c.Level, c.Exp, c.SpPoint, c.Money,
              c.Race, c.Class, c.Gender, c.Adult, c.GameMaster,
              c.is_online AS IsOnline,
              u.Id AS PendingUpdateId, u.Status AS PendingStatus,
              u.Level AS PendingLevel, u.Exp AS PendingExp,
              u.SpPoint AS PendingSpPoint, u.Money AS PendingMoney,
              u.Cash AS PendingCash, u.CreatedAt AS PendingCreatedAt
         FROM characters c
         LEFT JOIN admin_character_updates u
           ON u.Id = (
             SELECT MAX(active.Id) FROM admin_character_updates active
              WHERE active.CharID = c.CharID
                AND active.Status IN ('pending', 'waiting_logout')
           )
        WHERE c.AccountID IN (${placeholders})
        ORDER BY c.AccountID DESC, c.CharID ASC`,
      accountIds,
    );
    characterRows = rows;
  }

  const charactersByAccount = new Map<number, CharacterSummary[]>();
  for (const row of characterRows) {
    const entries = charactersByAccount.get(row.AccountID) ?? [];
    entries.push(toCharacterDto(row));
    charactersByAccount.set(row.AccountID, entries);
  }

  const total = Number(countRows[0]?.total ?? 0);
  const accounts: AccountSummary[] = accountRows.map((row) => ({
    vip: Number(row.vip),
    vipExpiresAt: row.vip_expires_at?.toISOString() ?? null,
    accountId: row.AccountID,
    username: row.Username,
    status: row.acc_status,
    email: row.email,
    adminLevel: row.admin,
    gameMaster: Boolean(row.isGm),
    mallPoints: row.mallpoints,
    registeredAt: row.reg_date?.toISOString() ?? null,
    lastLogin: row.last_login?.toISOString() ?? null,
    characters: charactersByAccount.get(row.AccountID) ?? [],
  }));

  return {
    accounts,
    vipExpirySupported,
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
  await ensureAdminSchema();
  const connection = await getCharacterPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<CharacterRow[]>(
      `SELECT CharID, AccountID, CharName, Level, Exp, SpPoint, Money,
              Race, Class, Gender, Adult, GameMaster,
              is_online AS IsOnline
         FROM characters
        WHERE CharID = ?
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
      "SELECT mallpoints FROM accounts WHERE AccountID = ? LIMIT 1",
      [current.AccountID],
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
        current.AccountID,
        values.level,
        values.experience,
        values.skillPoints,
        values.money,
        values.cash,
        current.Level,
        current.Exp,
        current.SpPoint,
        current.Money,
        oldCash,
        requestedBy.slice(0, 64),
      ],
    );

    await connection.commit();
    return {
      ok: true,
      previous: {
        level: current.Level,
        experience: current.Exp,
        skillPoints: current.SpPoint,
        money: current.Money,
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
