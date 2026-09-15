import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.CHARACTER_DB_HOST,
  port: Number(process.env.CHARACTER_DB_PORT || 3306),
  user: process.env.CHARACTER_DB_USER,
  password: process.env.CHARACTER_DB_PASSWORD,
  database: process.env.CHARACTER_DB_NAME,
  timezone: "Z",
});
try {
  if (process.argv.includes("--migrate")) {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_items (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, RequestKey CHAR(36) NOT NULL,
      AccountID INT UNSIGNED NOT NULL, CharID INT UNSIGNED NOT NULL,
      ItemTblidx INT UNSIGNED NOT NULL, ItemName VARCHAR(100) NOT NULL,
      StackCount TINYINT UNSIGNED NOT NULL DEFAULT 1, ItemRank TINYINT UNSIGNED NOT NULL DEFAULT 0,
      Durability TINYINT UNSIGNED NOT NULL DEFAULT 0, BattleAttribute TINYINT UNSIGNED NOT NULL DEFAULT 0,
      OptionTblidx INT UNSIGNED NOT NULL DEFAULT 4294967295,
      DurationType TINYINT UNSIGNED NOT NULL DEFAULT 0, UseDurationMax INT UNSIGNED NOT NULL DEFAULT 0,
      Message VARCHAR(127) NOT NULL, RequestedBy VARCHAR(64) NOT NULL,
      Status VARCHAR(24) NOT NULL DEFAULT 'pending', ItemID BIGINT UNSIGNED NULL,
      MailID INT UNSIGNED NULL, ErrorMessage VARCHAR(255) NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_request (RequestKey),
      KEY idx_admin_mail_status (Status, Id), KEY idx_admin_mail_character (CharID, Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_mail_batches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, BatchKey CHAR(36) NOT NULL,
      VipLevel TINYINT UNSIGNED NOT NULL, ItemTblidx INT UNSIGNED NOT NULL,
      ItemName VARCHAR(100) NOT NULL, StackCount TINYINT UNSIGNED NOT NULL,
      Message VARCHAR(127) NOT NULL, RequestedBy VARCHAR(64) NOT NULL,
      RecipientCount INT UNSIGNED NOT NULL DEFAULT 0, SkippedCount INT UNSIGNED NOT NULL DEFAULT 0,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_batch (BatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
  }
  const [tables] = await pool.query("SHOW TABLES LIKE 'admin_mail_items'");
  const [columns] = tables.length ? await pool.query("SHOW COLUMNS FROM admin_mail_items") : [[]];
  const [counts] = tables.length ? await pool.query("SELECT Status, COUNT(*) total FROM admin_mail_items GROUP BY Status") : [[]];
  const [batchTables] = await pool.query("SHOW TABLES LIKE 'admin_mail_batches'");
  const [batchCount] = batchTables.length ? await pool.query("SELECT COUNT(*) total FROM admin_mail_batches") : [[{ total: 0 }]];
  const accountDatabase = process.env.ACCOUNT_DB_NAME;
  const [expiryColumns] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME='accounts' AND COLUMN_NAME='vip_expires_at' LIMIT 1`, [accountDatabase]);
  const activeVip = expiryColumns.length
    ? "a.vip BETWEEN 1 AND 3 AND (a.vip_expires_at IS NULL OR a.vip_expires_at>UTC_TIMESTAMP())"
    : "a.vip BETWEEN 1 AND 3";
  if (!/^[A-Za-z0-9_]+$/.test(accountDatabase ?? "")) throw new Error("ACCOUNT_DB_NAME inválido.");
  const [groups] = await pool.query(`SELECT a.vip vipLevel,COUNT(*) total,
    COALESCE(SUM((SELECT COUNT(*) FROM mail m WHERE m.CharID=c.CharID)>=30),0) fullMailboxes
    FROM characters c
    JOIN (SELECT AccountID, MIN(CharID) CharID FROM characters GROUP BY AccountID) first_character
      ON first_character.AccountID=c.AccountID AND first_character.CharID=c.CharID
    JOIN \`${accountDatabase}\`.accounts a ON a.AccountID=c.AccountID
    WHERE ${activeVip} GROUP BY a.vip ORDER BY a.vip`);
  console.log({ tableExists: tables.length === 1, columns: columns.length, requests: counts, batchTableExists: batchTables.length === 1, batches: Number(batchCount[0]?.total ?? 0), groupPreview: groups });
} finally { await pool.end(); }
