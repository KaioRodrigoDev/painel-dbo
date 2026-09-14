import "server-only";

import { z } from "zod";

const databaseSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1),
  password: z.string(),
  database: z.string().regex(/^[A-Za-z0-9_]+$/),
});

export function getAccountDatabaseConfig() {
  return databaseSchema.parse({
    host: process.env.ACCOUNT_DB_HOST,
    port: process.env.ACCOUNT_DB_PORT ?? "3306",
    user: process.env.ACCOUNT_DB_USER,
    password: process.env.ACCOUNT_DB_PASSWORD ?? "",
    database: process.env.ACCOUNT_DB_NAME,
  });
}

export function getCharacterDatabaseConfig() {
  return databaseSchema.parse({
    host: process.env.CHARACTER_DB_HOST,
    port: process.env.CHARACTER_DB_PORT ?? "3306",
    user: process.env.CHARACTER_DB_USER,
    password: process.env.CHARACTER_DB_PASSWORD ?? "",
    database: process.env.CHARACTER_DB_NAME,
  });
}

export function getAdminConfig() {
  return z
    .object({
      username: z.string().min(3),
      password: z.string().min(12),
      sessionSecret: z.string().min(32),
      secureCookie: z.enum(["true", "false"]).transform((value) => value === "true"),
      maxCharacterLevel: z.coerce.number().int().min(1).max(255),
    })
    .parse({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
      sessionSecret: process.env.SESSION_SECRET,
      secureCookie:
        process.env.ADMIN_COOKIE_SECURE ??
        (process.env.NODE_ENV === "production" ? "true" : "false"),
      maxCharacterLevel: process.env.MAX_CHARACTER_LEVEL ?? "70",
    });
}
