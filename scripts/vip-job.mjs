import { vipPool } from "./vip-db.mjs";
import { migrateVip, expireVip } from "../src/lib/vip-store.ts";
const pool = vipPool();
try {
  if (process.argv.includes("--migrate")) { await migrateVip(pool); console.log("Migração VIP 001 concluída."); }
  else console.log(JSON.stringify(await expireVip(pool, process.argv.includes("--dry-run"))));
} catch (error) {
  console.error("Falha na rotina VIP:", error.code ?? error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
