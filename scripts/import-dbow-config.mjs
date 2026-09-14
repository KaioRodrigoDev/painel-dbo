// Gera a configuração local do painel DBOW a partir do QueryServer.ini.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const defaultConfig = path.resolve(
  process.cwd(),
  "..",
  "DboServer",
  "ExecutionEnv",
  "config",
  "QueryServer.ini",
);
const configPath = path.resolve(process.argv[2] ?? defaultConfig);
const outputPath = path.resolve(process.cwd(), ".env.local");
const force = process.argv.includes("--force");

if (!existsSync(configPath)) {
  throw new Error(`QueryServer.ini não encontrado em: ${configPath}`);
}
if (existsSync(outputPath) && !force) {
  throw new Error(".env.local já existe. Use --force apenas se quiser substituí-lo.");
}

function parseIni(source) {
  const sections = {};
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      current = section[1];
      sections[current] ??= {};
      continue;
    }
    const separator = line.indexOf("=");
    if (current && separator > 0) {
      sections[current][line.slice(0, separator).trim()] = line
        .slice(separator + 1)
        .trim();
    }
  }
  return sections;
}

function required(section, key) {
  const value = section?.[key];
  if (value === undefined) throw new Error(`Configuração ausente: ${key}`);
  return value;
}

function requiredAny(section, keys) {
  for (const key of keys) {
    if (section?.[key] !== undefined) return section[key];
  }
  throw new Error(`Configuração ausente: ${keys.join(" ou ")}`);
}

function envValue(value) {
  return JSON.stringify(String(value).replaceAll("$", "\\$"));
}

const ini = parseIni(readFileSync(configPath, "utf8"));
const account = ini.DATABASE_ACCOUNT;
const character = ini.DATABASE_CHARACTER;
const initialPassword = randomBytes(18).toString("base64url");
const sessionSecret = randomBytes(48).toString("base64url");

const variables = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: initialPassword,
  SESSION_SECRET: sessionSecret,
  ADMIN_COOKIE_SECURE: "false",
  MAX_CHARACTER_LEVEL: "70",
  ACCOUNT_DB_HOST: required(account, "Host"),
  ACCOUNT_DB_PORT: required(account, "Port"),
  ACCOUNT_DB_USER: required(account, "User"),
  ACCOUNT_DB_PASSWORD: required(account, "Password"),
  ACCOUNT_DB_NAME: requiredAny(account, ["Db", "DbName"]),
  CHARACTER_DB_HOST: required(character, "Host"),
  CHARACTER_DB_PORT: required(character, "Port"),
  CHARACTER_DB_USER: required(character, "User"),
  CHARACTER_DB_PASSWORD: required(character, "Password"),
  CHARACTER_DB_NAME: requiredAny(character, ["Db", "DbName"]),
};

const contents = Object.entries(variables)
  .map(([key, value]) => `${key}=${envValue(value)}`)
  .join("\n");
writeFileSync(outputPath, `${contents}\n`, { encoding: "utf8", flag: "w" });

console.log(`Configuração criada em ${outputPath}`);
console.log("Usuário inicial: admin");
console.log(`Senha inicial: ${initialPassword}`);
console.log("Altere ADMIN_PASSWORD em .env.local depois do primeiro acesso.");
