import mysql from "mysql2/promise";

export function vipPool() {
  return mysql.createPool({ host: process.env.ACCOUNT_DB_HOST, port: Number(process.env.ACCOUNT_DB_PORT || 3306), user: process.env.ACCOUNT_DB_USER, password: process.env.ACCOUNT_DB_PASSWORD, database: process.env.ACCOUNT_DB_NAME, timezone: "Z", connectionLimit: 3 });
}
