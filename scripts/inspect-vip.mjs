import { vipPool } from "./vip-db.mjs";
const pool = vipPool();
try {
  for (const sql of ["SELECT VERSION() version", "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts'", "SHOW COLUMNS FROM accounts WHERE Field IN ('vip','vip_expires_at')"]) {
    const [rows] = await pool.query(sql); console.log(rows);
  }
  // Auditoria do MDBO (20261019_accounts_vip.sql); o painel não usa mais admin_vip_runs.
  const [operations] = await pool.query("SELECT request_id, account_id, action, old_level, new_level, new_expiry, created_at FROM vip_admin_operations ORDER BY created_at DESC LIMIT 5");
  console.log({ lastVipOperations: operations });
} finally { await pool.end(); }
