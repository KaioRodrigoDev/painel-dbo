import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type CharacterAuditEntry = {
  administrator: string;
  action: "character.update.requested";
  characterId: number;
  characterName: string;
  previous: Record<string, number>;
  next: Record<string, number>;
};

type ServerAuditEntry = {
  administrator: string;
  action:
    | "servers.start"
    | "servers.stop"
    | "servers.restart"
    | "servers.start_all"
    | "servers.stop_all"
    | "servers.selection_updated";
  target: string;
  details?: Record<string, unknown>;
};

type ItemAuditEntry = {
  administrator: string;
  action: "items.draft_create";
  target: string;
};

type SkillAuditEntry = {
  administrator: string;
  action: "skills.draft_create" | "skills.draft_edit" | "skills.rdf_publish" | "skills.layout_publish";
  target: string;
  details?: Record<string, unknown>;
};

type AuditEntry = CharacterAuditEntry | ServerAuditEntry | ItemAuditEntry | SkillAuditEntry;

export async function writeAuditLog(entry: AuditEntry) {
  const auditDirectory = path.join(process.cwd(), "data");
  await mkdir(auditDirectory, { recursive: true });
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  await appendFile(path.join(auditDirectory, "admin-audit.jsonl"), `${line}\n`, "utf8");
}
