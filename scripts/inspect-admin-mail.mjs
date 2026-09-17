import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.ACCOUNT_DB_HOST,
  port: Number(process.env.ACCOUNT_DB_PORT || 3306),
  user: process.env.ACCOUNT_DB_USER,
  password: process.env.ACCOUNT_DB_PASSWORD,
  database: process.env.ACCOUNT_DB_NAME,
  timezone: "Z",
});
const characterPool = mysql.createPool({
  host: process.env.CHARACTER_DB_HOST,
  port: Number(process.env.CHARACTER_DB_PORT || 3306),
  user: process.env.CHARACTER_DB_USER,
  password: process.env.CHARACTER_DB_PASSWORD,
  database: process.env.CHARACTER_DB_NAME,
  timezone: "Z",
});

try {
  if (process.argv.includes("--migrate")) {
    await characterPool.query(`CREATE TABLE IF NOT EXISTS admin_mail_items (
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
    const [sealColumns] = await characterPool.query("SHOW COLUMNS FROM admin_mail_items LIKE 'SealItem'");
    if (!sealColumns.length) await characterPool.query("ALTER TABLE admin_mail_items ADD COLUMN SealItem TINYINT UNSIGNED NOT NULL DEFAULT 0");
    for (const [column, definition] of Object.entries({ ClaimedAt: "TIMESTAMP NULL", ClaimedByCharID: "INT UNSIGNED NULL", ClaimedPlace: "TINYINT UNSIGNED NULL", ClaimedPos: "TINYINT UNSIGNED NULL" })) {
      const [columns] = await characterPool.query(`SHOW COLUMNS FROM admin_mail_items LIKE '${column}'`);
      if (!columns.length) await characterPool.query(`ALTER TABLE admin_mail_items ADD COLUMN ${column} ${definition}`);
    }
    await characterPool.query(`UPDATE admin_mail_items q INNER JOIN mail m ON m.id=q.MailID
      SET q.Status='claimed',q.ClaimedByCharID=COALESCE(q.ClaimedByCharID,q.CharID)
      WHERE m.IsAccept=1 AND q.Status='applied'`);
    await characterPool.query(`CREATE TABLE IF NOT EXISTS admin_mail_batches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, BatchKey CHAR(36) NOT NULL,
      VipLevel TINYINT UNSIGNED NOT NULL, ItemTblidx INT UNSIGNED NOT NULL,
      ItemName VARCHAR(100) NOT NULL, StackCount TINYINT UNSIGNED NOT NULL,
      Message VARCHAR(127) NOT NULL, RequestedBy VARCHAR(64) NOT NULL,
      SealItem TINYINT UNSIGNED NOT NULL DEFAULT 0,
      RecipientCount INT UNSIGNED NOT NULL DEFAULT 0, SkippedCount INT UNSIGNED NOT NULL DEFAULT 0,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_batch (BatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    const [batchSealColumns] = await characterPool.query("SHOW COLUMNS FROM admin_mail_batches LIKE 'SealItem'");
    if (!batchSealColumns.length) await characterPool.query("ALTER TABLE admin_mail_batches ADD COLUMN SealItem TINYINT UNSIGNED NOT NULL DEFAULT 0");
    await characterPool.query(`CREATE TABLE IF NOT EXISTS admin_mail_recipient_preferences (
      AccountID INT UNSIGNED NOT NULL PRIMARY KEY, CharID INT UNSIGNED NOT NULL,
      UpdatedBy VARCHAR(64) NOT NULL,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await characterPool.query(`CREATE TABLE IF NOT EXISTS admin_mail_package_dispatches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, DispatchKey CHAR(36) NOT NULL,
      PackageID CHAR(36) NOT NULL, Signature CHAR(64) NOT NULL,
      RecipientCount INT UNSIGNED NOT NULL, ItemCount INT UNSIGNED NOT NULL,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_mail_package_dispatch (DispatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_cashshop_items (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, RequestKey CHAR(36) NOT NULL,
      AccountID INT UNSIGNED NOT NULL, ItemTblidx INT UNSIGNED NOT NULL,
      HLSitemTblidx INT UNSIGNED NOT NULL, ItemName VARCHAR(100) NOT NULL,
      StackCount TINYINT UNSIGNED NOT NULL DEFAULT 1, RequestedBy VARCHAR(64) NOT NULL,
      Status VARCHAR(24) NOT NULL DEFAULT 'pending', ProductID BIGINT UNSIGNED NULL,
      ErrorMessage VARCHAR(255) NULL, CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_cashshop_request (RequestKey),
      KEY idx_admin_cashshop_status (Status, Id), KEY idx_admin_cashshop_account (AccountID, Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_cashshop_batches (
      Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, BatchKey CHAR(36) NOT NULL,
      VipLevel TINYINT UNSIGNED NOT NULL, ItemTblidx INT UNSIGNED NOT NULL,
      HLSitemTblidx INT UNSIGNED NOT NULL, ItemName VARCHAR(100) NOT NULL,
      StackCount TINYINT UNSIGNED NOT NULL, RequestedBy VARCHAR(64) NOT NULL,
      RecipientCount INT UNSIGNED NOT NULL DEFAULT 0,
      CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Id), UNIQUE KEY uq_admin_cashshop_batch (BatchKey)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`);
  }
  const [tables] = await pool.query("SHOW TABLES LIKE 'admin_cashshop_items'");
  const [columns] = tables.length ? await pool.query("SHOW COLUMNS FROM admin_cashshop_items") : [[]];
  const [counts] = tables.length ? await pool.query("SELECT Status,COUNT(*) total FROM admin_cashshop_items GROUP BY Status") : [[]];
  const [batchTables] = await pool.query("SHOW TABLES LIKE 'admin_cashshop_batches'");
  const [batchCount] = batchTables.length ? await pool.query("SELECT COUNT(*) total FROM admin_cashshop_batches") : [[{ total: 0 }]];
  const [expiryColumns] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND COLUMN_NAME='vip_expires_at' LIMIT 1`);
  const activeVip = expiryColumns.length
    ? "vip BETWEEN 1 AND 3 AND (vip_expires_at IS NULL OR vip_expires_at>UTC_TIMESTAMP())"
    : "vip BETWEEN 1 AND 3";
  const [groups] = await pool.query(`SELECT vip vipLevel,COUNT(*) total FROM accounts
    WHERE ${activeVip} GROUP BY vip ORDER BY vip`);
  console.log({ tableExists: tables.length === 1, columns: columns.length, requests: counts,
    batchTableExists: batchTables.length === 1, batches: Number(batchCount[0]?.total ?? 0), groupPreview: groups });
  const [mailTables] = await characterPool.query("SHOW TABLES LIKE 'admin_mail_items'");
  const [mailCounts] = mailTables.length ? await characterPool.query("SELECT Status,COUNT(*) total FROM admin_mail_items GROUP BY Status") : [[]];
  const [mailBatches] = await characterPool.query("SHOW TABLES LIKE 'admin_mail_batches'");
  const [preferences] = await characterPool.query("SHOW TABLES LIKE 'admin_mail_recipient_preferences'");
  const [packageDispatches] = await characterPool.query("SHOW TABLES LIKE 'admin_mail_package_dispatches'");
  console.log({ mailTableExists: mailTables.length === 1, mailRequests: mailCounts,
    mailBatchTableExists: mailBatches.length === 1, preferenceTableExists: preferences.length === 1,
    packageDispatchTableExists: packageDispatches.length === 1 });
} finally { await Promise.all([pool.end(), characterPool.end()]); }
