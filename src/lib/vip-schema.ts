import type { Pool, RowDataPacket } from "mysql2/promise";

const supportByPool = new WeakMap<Pool, Promise<boolean>>();

export function hasVipExpiryColumn(pool: Pool) {
  let support = supportByPool.get(pool);
  if (!support) {
    support = pool.query<RowDataPacket[]>(`
      SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'accounts'
         AND COLUMN_NAME = 'vip_expires_at'
       LIMIT 1
    `).then(([rows]) => rows.length === 1);
    supportByPool.set(pool, support);
  }
  return support;
}
