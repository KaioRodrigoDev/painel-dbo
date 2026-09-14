import { vipPool } from "./vip-db.mjs";
const pool = vipPool();
try {
  for (const sql of ["SELECT VERSION() version", "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts'", "SHOW COLUMNS FROM accounts WHERE Field IN ('vip','vip_expires_at')"]) {
    const [rows] = await pool.query(sql); console.log(rows);
  }
  const [runs] = await pool.query("SELECT id, started_at, finished_at, status, processed, error_message FROM admin_vip_runs ORDER BY started_at DESC LIMIT 1");
  console.log({ lastVipRun: runs[0] ?? null });
} finally { await pool.end(); }
