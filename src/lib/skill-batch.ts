import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { SKILL_CREATION_FIELDS, SYSTEM_EFFECT_APPLY_TYPE_OPTIONS, type SkillCreationFieldId } from "@/lib/skill-creation-definitions";
import { loadSkillCatalog, resolveSkillCatalogPath } from "@/lib/skill-catalog";
import { discardSkillDrafts, listSkillDrafts, markSkillDraftPublished } from "@/lib/skill-drafts";
import {
  applySkillPackTable,
  defaultClientPackDirectory,
  prepareSkillPackTableCopy,
  resolveRequestedPackDirectory,
  restoreSkillPackBackup,
  type SkillPackTableWriter,
} from "@/lib/skill-pack-publisher";
import { analyzeSkillDraft, applySkillChanges, findSkillRecordOffset, replaceSkillRdf, withSkillPublicationLock } from "@/lib/skill-rdf-publisher";
import { constantTimeEqual } from "@/lib/security";
import { loadSystemEffectCatalog } from "@/lib/system-effect-catalog";
import { writeZip } from "@/lib/zip-writer";
import type {
  SkillBatchApplyResult, SkillBatchChange, SkillBatchExportResult, SkillBatchItem, SkillBatchPreview,
  SkillCatalogEntry, SkillDraft, SkillDraftValue, SkillPublishChange,
} from "@/lib/types";

/**
 * Lote de edições de skill.
 *
 * Cada skill tem no máximo um rascunho pendente (o editor reabre e atualiza esse mesmo
 * rascunho). O lote junta todos eles para três saídas:
 *
 *   - aplicar: grava de uma vez no RDF do servidor e/ou no pack do cliente local;
 *   - exportar: gera um .zip com o relatório das mudanças e os arquivos prontos para
 *     substituir (pack do cliente e RDF do servidor), sem alterar nada;
 *   - descartar: tira rascunhos da fila.
 *
 * Uma skill com problema (por exemplo, nome alterado, que mora noutra tabela) fica de fora
 * com o motivo escrito; as outras seguem.
 */

const EXPORT_DIRECTORY = path.join(process.cwd(), "data", "skill-exports");
const KEEP_EXPORTS = 5;
const EMPTY_REF = 0xffffffff;
const CLASS_NAMES = ["Lutador humano", "Místico humano", "Engenheiro humano", "Guerreiro Namek", "Místico Namek", "Mighty Majin", "Wonder Majin", "Street Fighter", "Sword Master", "Crane Roshi", "Turtle Roshi", "Gun Mania", "Mech Mania", "Dark Warrior", "Shadow Knight", "Dende Priest", "Poko Priest", "Ultimate Majin", "Grand Chef Majin", "Plasma Majin", "Karma Majin"];
const APPLY_TYPE_LABELS = new Map(SYSTEM_EFFECT_APPLY_TYPE_OPTIONS.map((option) => [option.value, option.label]));

const hashBuffer = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");
// Espaço de efeito vazio guarda o maior double possível; mostrar o número só confundiria.
const formatNumber = (value: number) => (Math.abs(value) > 1e30 ? "sem valor" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value));

type Describer = (fieldId: string, value: SkillDraftValue | undefined) => string;

/** Traduz o valor gravado para algo que se lê sem tabela do lado. */
function createDescriber(skills: Map<number, SkillCatalogEntry>, effects: Map<number, { name: string }> | null): Describer {
  const isEmpty = (ref: number) => ref === 0 || ref === EMPTY_REF;
  const skillName = (ref: number) => (isEmpty(ref) ? "nenhuma" : `${skills.get(ref)?.name ?? "skill desconhecida"} (#${ref})`);
  return (fieldId, value) => {
    if (value === undefined || value === "") return "—";
    if ((fieldId === "rootSkillId" || fieldId === "nextSkillId") && typeof value === "number") return skillName(value);
    if (fieldId === "prerequisiteSkillIds" && Array.isArray(value)) {
      return [0, 1].map((pair) => {
        const min = value[pair * 2] ?? EMPTY_REF;
        const max = value[pair * 2 + 1] ?? EMPTY_REF;
        return isEmpty(min) && isEmpty(max) ? `par ${pair + 1}: sem exigência` : `par ${pair + 1}: ${skillName(min)} até ${skillName(max)}`;
      }).join(" · ");
    }
    if (fieldId === "effectIds" && Array.isArray(value)) return value.map((ref) => (isEmpty(ref) ? "vazio" : `${effects?.get(ref)?.name ?? "efeito"} (#${ref})`)).join(" · ");
    if (fieldId === "effectTypes" && Array.isArray(value)) return value.map((type) => APPLY_TYPE_LABELS.get(type) ?? `tipo ${type}`).join(" · ");
    if (fieldId === "classFlag" && typeof value === "number") {
      const names = CLASS_NAMES.filter((_, index) => (value & (1 << index)) !== 0);
      return `${names.length ? names.join(", ") : "nenhuma classe"} (${value})`;
    }
    if ((fieldId === "functionFlag" || fieldId === "restrictionRuleFlag") && typeof value === "number") return `0x${value.toString(16).toUpperCase()}`;
    if (fieldId.endsWith("Ms") && typeof value === "number") return `${formatNumber(value)} ms (${formatNumber(value / 1000)} s)`;
    const options = SKILL_CREATION_FIELDS[fieldId as SkillCreationFieldId]?.options;
    if (options && typeof value === "number") return `${options.find((option) => option.value === value)?.label ?? "valor"} (${value})`;
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    if (Array.isArray(value)) return value.map((entry) => formatNumber(entry)).join(", ");
    if (typeof value === "number") return formatNumber(value);
    return value;
  };
}

/** Lê os rascunhos pendentes e compara cada um com o RDF atual. */
async function analyzeBatch() {
  const drafts = (await listSkillDrafts()).filter((draft) => draft.status === "draft" && draft.operation === "edit");
  // listSkillDrafts devolve do mais novo para o mais velho: o primeiro de cada skill é o vigente.
  const groups = new Map<number, SkillDraft[]>();
  for (const draft of drafts) groups.set(draft.newTblidx, [...(groups.get(draft.newTblidx) ?? []), draft]);

  const catalog = await loadSkillCatalog();
  const skills = new Map(catalog.skills.map((skill) => [skill.tblidx, skill]));
  const effects = await loadSystemEffectCatalog().then((loaded) => loaded.byTblidx).catch(() => null);
  const describe = createDescriber(skills, effects);

  const rdfPath = resolveSkillCatalogPath();
  const rdfBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
  const rdfHash = hashBuffer(rdfBuffer);

  const items: SkillBatchItem[] = [];
  for (const [tblidx, group] of groups) {
    const latest = group[0];
    const current = skills.get(tblidx);
    let changes: SkillPublishChange[] = [];
    let blockingIssues: string[] = [];
    if (!current) blockingIssues = ["A skill não existe mais no Table_Skill_Data.rdf atual."];
    else ({ changes, blockingIssues } = analyzeSkillDraft(latest, current));
    items.push({
      draftId: latest.id,
      tblidx,
      name: current?.name ?? latest.name,
      iconName: current?.iconName ?? "",
      administrator: latest.administrator,
      updatedAt: latest.updatedAt,
      changes: changes.map((change): SkillBatchChange => ({ ...change, beforeText: describe(change.id, change.before), afterText: describe(change.id, change.after) })),
      blockingIssues,
      supersededDraftIds: group.slice(1).map((draft) => draft.id),
    });
  }
  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const ready = items.filter((item) => !item.blockingIssues.length);
  const token = ready.length
    ? createHash("sha256").update(JSON.stringify({ rdfHash, ready: ready.map((item) => [item.draftId, item.updatedAt, item.changes.map((change) => [change.id, change.after])]) })).digest("hex")
    : null;
  const preview: SkillBatchPreview = {
    items,
    readyCount: ready.length,
    changeCount: ready.reduce((total, item) => total + item.changes.length, 0),
    rdfPath,
    defaultClientPackDirectory: defaultClientPackDirectory(),
    token,
  };
  return { preview, ready, rdfBuffer, rdfHash };
}

export async function getSkillBatchPreview() {
  return (await analyzeBatch()).preview;
}

function assertToken(token: string, current: string | null) {
  if (!current) throw new Error("Nenhuma skill do lote está pronta para ser aplicada.");
  if (!constantTimeEqual(token, current)) throw new Error("O lote mudou desde a revisão (um rascunho ou o RDF foi alterado). Revise de novo antes de continuar.");
}

/** Escreve as mudanças de todas as skills prontas numa tabela (RDF inteiro ou a cópia do pack). */
const batchTableWriter = (ready: SkillBatchItem[]): SkillPackTableWriter => (table) => {
  for (const item of ready) applySkillChanges(table, findSkillRecordOffset(table, item.tblidx), item.changes);
};

const skippedOf = (items: SkillBatchItem[]) => items.filter((item) => item.blockingIssues.length).map((item) => ({ tblidx: item.tblidx, name: item.name, reason: item.blockingIssues.join(" ") }));

export async function applySkillBatch(
  token: string,
  options: { server: boolean; client: boolean; clientPackDirectory?: string | null },
  administrator: string,
): Promise<SkillBatchApplyResult> {
  return withSkillPublicationLock(async () => {
    if (!options.server && !options.client) throw new Error("Escolha aplicar no servidor, no cliente ou nos dois.");
    const { preview, ready, rdfHash } = await analyzeBatch();
    assertToken(token, preview.token);

    const label = `lote-${timestamp()}`;
    const writeTable = batchTableWriter(ready);

    // Mesma ordem da publicação individual: o pack primeiro, porque depende de arquivos de
    // fora; se o RDF falhar depois, o pack volta pelo backup e as duas cópias não divergem.
    const client = options.client
      ? await applySkillPackTable(writeTable, {
          backupDirectory: path.join(process.cwd(), "data", "skill-pack-backups"),
          label,
          directory: await resolveRequestedPackDirectory(options.clientPackDirectory),
        })
      : null;

    let server: SkillBatchApplyResult["server"] = null;
    if (options.server) {
      try {
        const latest = await readFile(/* turbopackIgnore: true */ preview.rdfPath);
        if (hashBuffer(latest) !== rdfHash) throw new Error("O Table_Skill_Data.rdf mudou durante a aplicação; nada foi gravado no servidor.");
        const next = Buffer.from(latest);
        writeTable(next);
        const backupPath = await replaceSkillRdf(preview.rdfPath, latest, next, label, ready.map((item) => ({ tblidx: item.tblidx, changes: item.changes })));
        server = { rdfPath: preview.rdfPath, backupPath };
      } catch (error) {
        if (client?.backupPath) await restoreSkillPackBackup(client.packPath, client.backupPath).catch(() => undefined);
        throw error;
      }
      // Só o servidor define "publicado": aplicar apenas no cliente mantém a skill no lote,
      // porque o RDF do servidor continua com o valor antigo.
      for (const item of ready) {
        await markSkillDraftPublished(item.draftId, administrator, server.backupPath);
        if (item.supersededDraftIds.length) await discardSkillDrafts(item.supersededDraftIds);
      }
    }

    return {
      applied: ready.map((item) => ({ tblidx: item.tblidx, name: item.name, changes: item.changes.length })),
      skipped: skippedOf(preview.items),
      server,
      client: client
        ? { packFileName: client.packFileName, packPath: client.packPath, backupPath: client.backupPath ? path.relative(process.cwd(), client.backupPath) : null }
        : null,
    };
  });
}

export async function exportSkillBatch(token: string, options: { clientPackDirectory?: string | null }, administrator: string): Promise<SkillBatchExportResult> {
  return withSkillPublicationLock(async () => {
    const { preview, ready, rdfBuffer } = await analyzeBatch();
    assertToken(token, preview.token);

    const stamp = timestamp();
    const exportId = `skills-${stamp}`;
    const staging = path.join(EXPORT_DIRECTORY, exportId);
    await rm(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
    await mkdir(/* turbopackIgnore: true */ staging, { recursive: true });

    try {
      const writeTable = batchTableWriter(ready);
      const pack = await prepareSkillPackTableCopy(writeTable, {
        outputDirectory: path.join(staging, "cliente"),
        directory: await resolveRequestedPackDirectory(options.clientPackDirectory),
      });
      const nextRdf = Buffer.from(rdfBuffer);
      writeTable(nextRdf);

      const generatedAt = new Date();
      const report = {
        generatedAt, administrator, ready, skipped: skippedOf(preview.items),
        files: [
          { name: `cliente/pack/${pack.packFileName}`, destination: `pasta pack do cliente (substitui ${pack.packFileName})`, sha256: pack.afterHash },
          { name: "servidor/Table_Skill_Data.rdf", destination: "DboServer\\ExecutionEnv\\resource\\server_data\\table\\rdf\\ (substitui Table_Skill_Data.rdf)", sha256: hashBuffer(nextRdf) },
        ],
      };

      const zipPath = path.join(EXPORT_DIRECTORY, `${exportId}.zip`);
      await writeZip(zipPath, [
        { name: "relatorio-de-mudancas.html", source: Buffer.from(renderReportHtml(report), "utf8") },
        // BOM para o Bloco de Notas antigo reconhecer os acentos.
        { name: "LEIA-ME.txt", source: Buffer.from(`﻿${renderReadme(report)}`, "utf8") },
        { name: `cliente/pack/${pack.packFileName}`, source: pack.packPath },
        { name: "servidor/Table_Skill_Data.rdf", source: nextRdf },
      ]);
      await pruneOldExports();

      return {
        exportId,
        fileName: `mdbo-skills-${stamp.slice(0, 19)}.zip`,
        size: (await stat(/* turbopackIgnore: true */ zipPath)).size,
        skills: ready.length,
        changes: ready.reduce((total, item) => total + item.changes.length, 0),
        packFileName: pack.packFileName,
      };
    } finally {
      await rm(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
    }
  });
}

/** Cada exportação carrega uma cópia do pack; guardar só as últimas evita encher o disco. */
async function pruneOldExports() {
  const zips = (await readdir(/* turbopackIgnore: true */ EXPORT_DIRECTORY)).filter((file) => /^skills-.+\.zip$/.test(file)).sort().reverse();
  for (const old of zips.slice(KEEP_EXPORTS)) await unlink(path.join(EXPORT_DIRECTORY, old)).catch(() => undefined);
}

export function skillExportPath(exportId: string) {
  if (!/^skills-[0-9TZ-]+$/.test(exportId)) throw new Error("Exportação inválida.");
  return path.join(EXPORT_DIRECTORY, `${exportId}.zip`);
}

/** Descarta os rascunhos pendentes das skills indicadas, ou de todas. */
export async function discardSkillBatch(tblidxs: number[] | "all") {
  const pending = (await listSkillDrafts()).filter((draft) => draft.status === "draft" && draft.operation === "edit"
    && (tblidxs === "all" || tblidxs.includes(draft.newTblidx)));
  await discardSkillDrafts(pending.map((draft) => draft.id));
  return { discarded: pending.length, skills: new Set(pending.map((draft) => draft.newTblidx)).size };
}

// ---------------------------------------------------------------- relatório

type Report = {
  generatedAt: Date;
  administrator: string;
  ready: SkillBatchItem[];
  skipped: { tblidx: number; name: string; reason: string }[];
  files: { name: string; destination: string; sha256: string }[];
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const formatDate = (date: Date) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(date);

function renderReportHtml(report: Report) {
  const total = report.ready.reduce((sum, item) => sum + item.changes.length, 0);
  const skills = report.ready.map((item) => `
    <section class="skill">
      <h2>${escapeHtml(item.name)} <span>#${item.tblidx}</span></h2>
      <table>
        <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
        <tbody>${item.changes.map((change) => `
          <tr><td><strong>${escapeHtml(change.label)}</strong><small>${escapeHtml(change.sourceField)}</small></td>
          <td class="before">${escapeHtml(change.beforeText)}</td><td class="after">${escapeHtml(change.afterText)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>`).join("");
  const skipped = report.skipped.length ? `
    <section class="skipped"><h2>Ficaram de fora (${report.skipped.length})</h2><ul>
      ${report.skipped.map((entry) => `<li><strong>${escapeHtml(entry.name)} #${entry.tblidx}</strong> — ${escapeHtml(entry.reason)}</li>`).join("")}
    </ul></section>` : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mudanças de skills — MDBO</title>
<style>
  :root { color-scheme: light; --ink: #15161c; --muted: #5d6170; --line: #e3e5ee; --accent: #5b4ce0; --soft: #f5f5fb; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 20px 60px; color: var(--ink); background: #fff; font: 15px/1.55 system-ui, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; }
  header { padding-bottom: 20px; margin-bottom: 26px; border-bottom: 3px solid var(--accent); }
  header small { color: var(--accent); font-weight: 700; letter-spacing: .14em; }
  h1 { margin: 6px 0 6px; font-size: 30px; }
  header p { margin: 0; color: var(--muted); }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  .stats span { padding: 6px 12px; border-radius: 99px; background: var(--soft); font-weight: 600; }
  .howto { padding: 18px 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--soft); margin-bottom: 30px; }
  .howto h2 { margin-top: 0; font-size: 18px; }
  .howto ol { margin: 0 0 14px; padding-left: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 9px 12px; color: var(--muted); font-size: 12px; letter-spacing: .06em; text-align: left; text-transform: uppercase; border-bottom: 2px solid var(--line); }
  td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td small { display: block; color: var(--muted); font: 11px ui-monospace, Consolas, monospace; }
  code { font: 12px ui-monospace, Consolas, monospace; word-break: break-all; }
  .skill { margin: 0 0 28px; break-inside: avoid; }
  .skill h2 { margin: 0 0 8px; font-size: 20px; }
  .skill h2 span { color: var(--muted); font-size: 14px; font-weight: 500; }
  .before { color: #8a3b3b; }
  .after { color: #1d6b43; font-weight: 600; }
  .skipped { padding: 16px 20px; border: 1px solid #f0d58a; border-radius: 12px; background: #fff9e8; }
  .skipped h2 { margin-top: 0; font-size: 17px; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
</style></head>
<body><main>
  <header>
    <small>MDBO · PAINEL ADMINISTRATIVO</small>
    <h1>Mudanças de skills</h1>
    <p>Gerado em ${escapeHtml(formatDate(report.generatedAt))} por ${escapeHtml(report.administrator)}.</p>
    <div class="stats"><span>${report.ready.length} skill${report.ready.length === 1 ? "" : "s"}</span><span>${total} campo${total === 1 ? "" : "s"} alterado${total === 1 ? "" : "s"}</span>${report.skipped.length ? `<span>${report.skipped.length} fora do pacote</span>` : ""}</div>
  </header>

  <section class="howto">
    <h2>Como aplicar</h2>
    <ol>
      <li><strong>Cliente:</strong> feche o jogo e copie o arquivo de <code>cliente/pack/</code> para a pasta <code>pack</code> da instalação, substituindo o existente. Guarde o original antes.</li>
      <li><strong>Servidor:</strong> copie <code>servidor/Table_Skill_Data.rdf</code> para a pasta de tabelas do servidor e reinicie o GameServer.</li>
    </ol>
    <table>
      <thead><tr><th>Arquivo no pacote</th><th>Onde colocar</th><th>SHA-256</th></tr></thead>
      <tbody>${report.files.map((file) => `<tr><td><code>${escapeHtml(file.name)}</code></td><td>${escapeHtml(file.destination)}</td><td><code>${file.sha256}</code></td></tr>`).join("")}</tbody>
    </table>
  </section>

  ${skills}
  ${skipped}
  <footer>Os dois arquivos precisam ir juntos: o cliente mostra os valores do pack, e o servidor aplica os do RDF.</footer>
</main></body></html>
`;
}

function renderReadme(report: Report) {
  const lines = [
    "MDBO - MUDANCAS DE SKILLS",
    `Gerado em ${formatDate(report.generatedAt)} por ${report.administrator}.`,
    "",
    "COMO APLICAR",
    "1. Cliente: feche o jogo e copie o arquivo de cliente/pack/ para a pasta pack da instalação, substituindo o existente.",
    "2. Servidor: copie servidor/Table_Skill_Data.rdf para DboServer\\ExecutionEnv\\resource\\server_data\\table\\rdf\\ e reinicie o GameServer.",
    "",
    "ARQUIVOS",
    ...report.files.map((file) => `- ${file.name}\r\n  destino: ${file.destination}\r\n  sha256: ${file.sha256}`),
    "",
    "MUDANCAS",
  ];
  for (const item of report.ready) {
    lines.push("", `${item.name} (#${item.tblidx})`);
    for (const change of item.changes) lines.push(`  - ${change.label}: ${change.beforeText}  ->  ${change.afterText}`);
  }
  if (report.skipped.length) {
    lines.push("", "FICARAM DE FORA");
    for (const entry of report.skipped) lines.push(`  - ${entry.name} (#${entry.tblidx}): ${entry.reason}`);
  }
  lines.push("", "O relatório completo está em relatorio-de-mudancas.html.");
  return lines.join("\r\n");
}

