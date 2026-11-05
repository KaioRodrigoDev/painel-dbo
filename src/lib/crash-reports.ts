import "server-only";

import type { RowDataPacket } from "mysql2/promise";

import { getAccountPool, tableExists } from "@/lib/db";

// Relatórios de crash do jogo que o launcher manda para a API de contas (POST /v1/crash-reports),
// gravados em mdbo_acc.launcher_crash_reports (mdbo-launcher/server/sql/005_crash_reports.sql).
// O pool do painel fala latin1; os textos longos (pilha, log) vêm em base64 de utf8mb4 para não
// perder caractere nenhum no caminho.

export type CrashStatus = "new" | "seen" | "fixed" | "ignored";
export const CRASH_STATUSES: CrashStatus[] = ["new", "seen", "fixed", "ignored"];

export type CrashGroup = {
  signature: string;
  signatureText: string;
  exception: string;
  exitCode: string;
  total: number;
  recent: number;
  accounts: number;
  firstAt: string;
  lastAt: string;
  status: CrashStatus;
  versions: string[];
};

export type CrashSummary = {
  id: number;
  createdAt: string;
  username: string | null;
  accountId: number | null;
  launcherVersion: string;
  gameVersion: string;
  architecture: string;
  graphics: string;
  playSeconds: number;
  status: CrashStatus;
};

export type CrashDetail = CrashSummary & {
  occurredAt: string | null;
  ip: string | null;
  windows: string;
  exitCode: string;
  exception: string;
  signature: string;
  signatureText: string;
  report: string;
  log: string;
  dxLog: string;
};

export type CrashOverview = {
  installed: boolean;
  counts: { today: number; week: number; open: number; accountsWeek: number };
  groups: CrashGroup[];
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const text = (base64: string | null) => (base64 ? Buffer.from(base64, "base64").toString("utf8") : "");

type GroupRow = RowDataPacket & {
  signature: string; signature_text: string; exception: string; exit_code: string; total: number; recent: number;
  accounts: number; first_at: Date; last_at: Date; open_count: number; statuses: string; versions: string | null;
};

/** Erros agrupados pela assinatura (mesmo código e mesmas funções no topo da pilha). */
export async function crashOverview(days: number, status: "open" | "all" | CrashStatus): Promise<CrashOverview> {
  const pool = getAccountPool();
  if (!(await tableExists(pool, "launcher_crash_reports"))) {
    return { installed: false, counts: { today: 0, week: 0, open: 0, accountsWeek: 0 }, groups: [] };
  }
  const [[counts]] = await pool.query<(RowDataPacket & { today: number; week: number; open_count: number; accounts_week: number })[]>(
    `SELECT
      COALESCE(SUM(created_at >= UTC_DATE()), 0) AS today,
      COALESCE(SUM(created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY), 0) AS week,
      COALESCE(SUM(status = 'new'), 0) AS open_count,
      COUNT(DISTINCT CASE WHEN created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY THEN COALESCE(account_id, CONCAT('u:', username), CONCAT('ip:', ip)) END) AS accounts_week
     FROM launcher_crash_reports`,
  );
  // Grupos com crash novo primeiro, depois os que mais aconteceram no período.
  const [rows] = await pool.query<GroupRow[]>(
    `SELECT * FROM (
      SELECT signature, MAX(signature_text) AS signature_text, MAX(exception) AS exception, MAX(exit_code) AS exit_code,
        COUNT(*) AS total,
        SUM(created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY) AS recent,
        COUNT(DISTINCT COALESCE(account_id, CONCAT('u:', username), CONCAT('ip:', ip))) AS accounts,
        MIN(created_at) AS first_at, MAX(created_at) AS last_at,
        SUM(status = 'new') AS open_count,
        GROUP_CONCAT(DISTINCT status) AS statuses,
        SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT NULLIF(game_version, '') ORDER BY created_at DESC SEPARATOR '|'), '|', 3) AS versions
       FROM launcher_crash_reports
       GROUP BY signature
       HAVING MAX(created_at) >= UTC_TIMESTAMP() - INTERVAL ? DAY
     ) AS grouped
     ORDER BY open_count > 0 DESC, recent DESC, last_at DESC
     LIMIT 200`,
    [days, days],
  );
  const groups = rows.map((row): CrashGroup => {
    const statuses = (row.statuses ?? "").split(",") as CrashStatus[];
    // O grupo mostra o pior estado: um crash novo reabre um grupo dado como corrigido.
    const groupStatus = statuses.includes("new") ? "new" : statuses.includes("seen") ? "seen" : statuses.includes("fixed") ? "fixed" : "ignored";
    return {
      signature: row.signature,
      signatureText: row.signature_text,
      exception: row.exception,
      exitCode: row.exit_code,
      total: Number(row.total),
      recent: Number(row.recent),
      accounts: Number(row.accounts),
      firstAt: iso(row.first_at)!,
      lastAt: iso(row.last_at)!,
      status: groupStatus,
      versions: row.versions ? row.versions.split("|") : [],
    };
  }).filter(group => status === "all" || (status === "open" ? group.status === "new" || group.status === "seen" : group.status === status));
  return {
    installed: true,
    counts: { today: Number(counts.today), week: Number(counts.week), open: Number(counts.open_count), accountsWeek: Number(counts.accounts_week) },
    groups,
  };
}

type SummaryRow = RowDataPacket & {
  id: number; created_at: Date; username: string | null; account_id: number | null; launcher_version: string; game_version: string;
  architecture: string; graphics: string; play_seconds: number; status: CrashStatus; account_name: string | null;
};

/** Os relatórios de um grupo, do mais novo para o mais velho. */
export async function crashesOf(signature: string): Promise<CrashSummary[]> {
  const [rows] = await getAccountPool().query<SummaryRow[]>(
    `SELECT r.id, r.created_at, r.username, r.account_id, r.launcher_version, r.game_version, r.architecture, r.graphics,
      r.play_seconds, r.status, a.username AS account_name
     FROM launcher_crash_reports r LEFT JOIN accounts a ON a.id = r.account_id
     WHERE r.signature = ? ORDER BY r.id DESC LIMIT 100`,
    [signature],
  );
  return rows.map(summary);
}

function summary(row: SummaryRow): CrashSummary {
  return {
    id: row.id,
    createdAt: iso(row.created_at)!,
    // Conta confirmada pelo token vale mais que o nome que o launcher disse.
    username: row.account_name ?? row.username,
    accountId: row.account_id,
    launcherVersion: row.launcher_version,
    gameVersion: row.game_version,
    architecture: row.architecture,
    graphics: row.graphics,
    playSeconds: row.play_seconds,
    status: row.status,
  };
}

type DetailRow = SummaryRow & {
  occurred_at: Date | null; ip: string | null; windows: string; exit_code: string; exception: string; signature: string;
  signature_text: string; report64: string | null; log64: string | null; dx64: string | null;
};

export async function crashDetail(id: number): Promise<CrashDetail | null> {
  const [rows] = await getAccountPool().query<DetailRow[]>(
    `SELECT r.id, r.created_at, r.occurred_at, r.username, r.account_id, r.ip, r.launcher_version, r.game_version, r.architecture,
      r.graphics, r.windows, r.exit_code, r.exception, r.signature, r.signature_text, r.play_seconds, r.status, a.username AS account_name,
      TO_BASE64(CONVERT(r.report USING utf8mb4)) AS report64, TO_BASE64(CONVERT(r.log USING utf8mb4)) AS log64,
      TO_BASE64(CONVERT(r.dx_log USING utf8mb4)) AS dx64
     FROM launcher_crash_reports r LEFT JOIN accounts a ON a.id = r.account_id WHERE r.id = ?`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...summary(row),
    occurredAt: iso(row.occurred_at),
    ip: row.ip,
    windows: row.windows,
    exitCode: row.exit_code,
    exception: row.exception,
    signature: row.signature,
    signatureText: row.signature_text,
    report: text(row.report64),
    log: text(row.log64),
    dxLog: text(row.dx64),
  };
}

/** Marca todos os relatórios do grupo (visto, corrigido, ignorado ou de volta para novo). */
export async function setGroupStatus(signature: string, status: CrashStatus) {
  const [result] = await getAccountPool().execute("UPDATE launcher_crash_reports SET status = ? WHERE signature = ?", [status, signature]);
  return "affectedRows" in result ? result.affectedRows : 0;
}
