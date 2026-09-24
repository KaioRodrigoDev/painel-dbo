import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  invalidateMobCatalogCache, loadMobCatalog, MOB_RDF_HEADER_SIZE, MOB_RDF_RECORD_SIZE, resolveMobCatalogPath,
} from "@/lib/mob-catalog";
import {
  basisLabel, basisLpMeaning, MAX_MOB_SKILLS, readMobSkillValues, SKILL_BASIS, writeMobSkillValues,
} from "@/lib/mob-skill-catalog";
import { constantTimeEqual } from "@/lib/security";
import { loadSkillCatalog } from "@/lib/skill-catalog";
import type { DropPublishChange, MobSkillDraft, MobSkillPublishPreview, MobSkillValues } from "@/lib/types";

const DRAFT_DIRECTORY = path.join(process.cwd(), "data", "mob-skill-drafts");
const VALID_BASIS = new Set<number>(SKILL_BASIS.map((entry) => entry.value));

let publicationInProgress = false;

const hashBuffer = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function createConfirmationToken(draftId: string, updatedAt: string, rdfHash: string, changes: DropPublishChange[]) {
  return createHash("sha256").update(JSON.stringify({ draftId, updatedAt, rdfHash, changes })).digest("hex");
}

export function validateMobSkillValues(values: MobSkillValues) {
  if (!Array.isArray(values.slots)) throw new Error("Lista de skills inválida.");
  if (values.slots.length > MAX_MOB_SKILLS) throw new Error(`Um mob aceita no máximo ${MAX_MOB_SKILLS} skills.`);

  const seen = new Set<number>();
  for (const [index, slot] of values.slots.entries()) {
    const position = index + 1;
    if (!Number.isInteger(slot.tblidx) || slot.tblidx < 1 || slot.tblidx > 4294967294) throw new Error(`Posição ${position}: TBLIDX de skill inválido.`);
    if (seen.has(slot.tblidx)) throw new Error(`Posição ${position}: a skill ${slot.tblidx} já está em outra posição deste mob.`);
    seen.add(slot.tblidx);
    // Fora de 3..7 o CSkillManagerBot::AddSkill cai no ramo de erro e nao registra a skill.
    if (!VALID_BASIS.has(slot.basis)) throw new Error(`Posição ${position}: condição ${slot.basis} não existe; o servidor descartaria a skill.`);
    if (!Number.isInteger(slot.lp) || slot.lp < 0 || slot.lp > 65535) throw new Error(`Posição ${position}: o valor de LP/alcance deve ficar entre 0 e 65535.`);
    if (!Number.isInteger(slot.time) || slot.time < 0 || slot.time > 65535) throw new Error(`Posição ${position}: o intervalo deve ficar entre 0 e 65535.`);
    if (basisLpMeaning(slot.basis) === "percent" && slot.lp > 100) throw new Error(`Posição ${position}: nesta condição o campo é porcentagem de vida e não pode passar de 100.`);
  }
}

export async function validateMobSkillReferences(values: MobSkillValues) {
  const catalog = await loadSkillCatalog();
  const known = new Map(catalog.skills.map((skill) => [skill.tblidx, skill]));
  const issues: string[] = [];
  for (const [index, slot] of values.slots.entries()) {
    const skill = known.get(slot.tblidx);
    if (!skill) issues.push(`Posição ${index + 1}: a skill ${slot.tblidx} não existe em Table_Skill_Data.rdf.`);
    else if (!skill.valid) issues.push(`Posição ${index + 1}: a skill ${slot.tblidx} está marcada como inválida na tabela.`);
  }
  return issues;
}

function diffMobSkillValues(before: MobSkillValues, after: MobSkillValues) {
  const changed: string[] = [];
  const count = Math.max(before.slots.length, after.slots.length);
  for (let index = 0; index < count; index += 1) {
    if (!sameValue(before.slots[index], after.slots[index])) changed.push(`slot.${index}`);
  }
  return changed;
}

async function describeSlot(slot: MobSkillValues["slots"][number] | undefined) {
  if (!slot) return "vazia";
  const catalog = await loadSkillCatalog();
  const skill = catalog.skills.find((entry) => entry.tblidx === slot.tblidx);
  const meaning = basisLpMeaning(slot.basis);
  const lpText = meaning === "unused" ? "" : meaning === "range" ? ` · alcance ${slot.lp}` : ` · LP ${slot.lp}%`;
  return `${skill?.name ?? "skill desconhecida"} (#${slot.tblidx}) · ${basisLabel(slot.basis)}${lpText} · intervalo ${slot.time}`;
}

/* ---------------------------------- rascunhos ---------------------------------- */

export async function listMobSkillDrafts() {
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const files = (await readdir(DRAFT_DIRECTORY)).filter((file) => /^[a-f0-9-]+\.json$/i.test(file));
  const drafts: MobSkillDraft[] = [];
  for (const file of files) {
    try { drafts.push(JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, file), "utf8")) as MobSkillDraft); }
    catch (error) { console.error(`Rascunho de skill de mob inválido: ${file}`, error); }
  }
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getMobSkillDraft(draftId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) throw new Error("Identificador de rascunho inválido.");
  try { return JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), "utf8")) as MobSkillDraft; }
  catch { throw new Error("Rascunho de skill de mob não encontrado."); }
}

export async function createMobSkillDraft(mobTblidx: number, values: MobSkillValues, administrator: string) {
  validateMobSkillValues(values);
  const catalog = await loadMobCatalog();
  const mob = catalog.mobs.find((candidate) => candidate.tblidx === mobTblidx);
  const recordOffset = catalog.offsetByTblidx.get(mobTblidx);
  if (!mob || recordOffset === undefined) throw new Error(`O mob ${mobTblidx} não existe em Table_MOB_Data.rdf.`);

  const baseValues = readMobSkillValues(catalog.buffer, recordOffset);
  const changedFields = diffMobSkillValues(baseValues, values);
  if (!changedFields.length) throw new Error("Altere pelo menos uma posição antes de salvar o rascunho.");

  const referenceIssues = await validateMobSkillReferences(values);
  if (referenceIssues.length) throw new Error(referenceIssues.join(" "));

  const open = (await listMobSkillDrafts()).filter((draft) => draft.status === "draft" && draft.mobTblidx === mobTblidx);
  if (open.length) throw new Error("Já existe um rascunho aberto para as skills deste mob. Publique ou descarte antes de criar outro.");

  const now = new Date().toISOString();
  const draft: MobSkillDraft = {
    id: randomUUID(), status: "draft", mobTblidx, mobName: mob.name,
    values, baseValues, changedFields, administrator, createdAt: now, updatedAt: now,
  };
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const target = path.join(DRAFT_DIRECTORY, `${draft.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return draft;
}

export async function deleteMobSkillDraft(draftId: string) {
  const draft = await getMobSkillDraft(draftId);
  if (draft.status === "published") throw new Error("Um rascunho já publicado não pode ser descartado.");
  await unlink(path.join(DRAFT_DIRECTORY, `${draftId}.json`));
  return draft;
}

async function markPublished(draftId: string, administrator: string, backupPath: string) {
  const draft = await getMobSkillDraft(draftId);
  const published: MobSkillDraft = { ...draft, status: "published", publishedAt: new Date().toISOString(), publishedBy: administrator, publicationBackup: backupPath };
  await writeFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), `${JSON.stringify(published, null, 2)}\n`, "utf8");
  return published;
}

/* ---------------------------------- publicação ---------------------------------- */

function findRecordOffset(buffer: Buffer, tblidx: number) {
  if (buffer.length <= MOB_RDF_HEADER_SIZE || (buffer.length - MOB_RDF_HEADER_SIZE) % MOB_RDF_RECORD_SIZE !== 0) {
    throw new Error("O formato atual do Table_MOB_Data.rdf é incompatível.");
  }
  let found = -1;
  for (let offset = MOB_RDF_HEADER_SIZE; offset < buffer.length; offset += MOB_RDF_RECORD_SIZE) {
    if (buffer.readUInt32LE(offset) !== tblidx) continue;
    if (found !== -1) throw new Error(`O RDF contém mais de um mob com TBLIDX ${tblidx}.`);
    found = offset;
  }
  if (found === -1) throw new Error(`O mob ${tblidx} não existe mais no RDF atual.`);
  return found;
}

async function publicationContext(draftId: string) {
  const draft = await getMobSkillDraft(draftId);
  const rdfPath = resolveMobCatalogPath();
  const rdfBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
  const rdfHash = hashBuffer(rdfBuffer);

  const blockingIssues: string[] = [];
  if (draft.status !== "draft") blockingIssues.push("Este rascunho já foi publicado.");
  try { validateMobSkillValues(draft.values); }
  catch (error) { blockingIssues.push(error instanceof Error ? error.message : "Os valores do rascunho são inválidos."); }
  blockingIssues.push(...(await validateMobSkillReferences(draft.values)));

  const changes: DropPublishChange[] = [];
  let recordOffset = -1;
  try {
    recordOffset = findRecordOffset(rdfBuffer, draft.mobTblidx);
    // O diff sai do RDF de agora, nao do snapshot do rascunho: o arquivo pode ter mudado por
    // fora entre salvar e publicar, e gravar o snapshot antigo desfaria isso em silencio.
    const currentValues = readMobSkillValues(rdfBuffer, recordOffset);
    for (const id of diffMobSkillValues(currentValues, draft.values)) {
      const index = Number(id.slice(5));
      changes.push({
        id, label: `Skill na posição ${index + 1}`,
        before: await describeSlot(currentValues.slots[index]),
        after: await describeSlot(draft.values.slots[index]),
      });
    }
  } catch (error) {
    blockingIssues.push(error instanceof Error ? error.message : "Não foi possível localizar o mob no RDF.");
  }

  if (recordOffset !== -1 && !changes.length) blockingIssues.push("O RDF atual já possui todas as skills deste rascunho.");

  const warnings = [
    "A publicação grava direto em Table_MOB_Data.rdf, na pasta de tabelas do servidor.",
    "O GameServer precisa ser reiniciado para recarregar a tabela; não existe comando de recarga.",
    "Os mobs já vivos no mundo mantêm as skills antigas até reaparecerem depois do reinício.",
  ];
  const confirmationToken = blockingIssues.length ? null : createConfirmationToken(draftId, draft.updatedAt, rdfHash, changes);
  return { draft, rdfPath, rdfHash, changes, warnings, blockingIssues, confirmationToken };
}

export async function getMobSkillPublishPreview(draftId: string): Promise<MobSkillPublishPreview> {
  const context = await publicationContext(draftId);
  return {
    draftId, mobTblidx: context.draft.mobTblidx, mobName: context.draft.mobName, rdfPath: context.rdfPath,
    changes: context.changes, warnings: context.warnings,
    blockingIssues: context.blockingIssues, confirmationToken: context.confirmationToken,
  };
}

export async function publishMobSkillDraft(draftId: string, confirmationToken: string, administrator: string) {
  if (publicationInProgress) throw new Error("Outra publicação de skills de mob está em andamento.");
  publicationInProgress = true;
  try {
    const context = await publicationContext(draftId);
    if (context.blockingIssues.length || !context.confirmationToken) throw new Error(context.blockingIssues.join(" ") || "O rascunho não pode ser publicado.");
    if (!constantTimeEqual(confirmationToken, context.confirmationToken)) throw new Error("A confirmação expirou porque o rascunho ou o RDF mudou. Valide novamente.");

    const { draft, rdfPath } = context;
    const latestBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
    const latestToken = createConfirmationToken(draftId, draft.updatedAt, hashBuffer(latestBuffer), context.changes);
    if (!constantTimeEqual(confirmationToken, latestToken)) throw new Error("O RDF mudou após a validação. Valide novamente antes de publicar.");

    const recordOffset = findRecordOffset(latestBuffer, draft.mobTblidx);
    const nextBuffer = Buffer.from(latestBuffer);
    writeMobSkillValues(nextBuffer, recordOffset, draft.values);
    if (nextBuffer.length !== latestBuffer.length) throw new Error("A gravação alterou o tamanho do arquivo; publicação cancelada.");

    const backupDirectory = path.join(process.cwd(), "data", "mob-rdf-backups");
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `Table_MOB_Data.${stamp}.before-${draftId}.rdf`);
    await copyFile(rdfPath, backupPath, fsConstants.COPYFILE_EXCL);
    if (hashBuffer(await readFile(backupPath)) !== hashBuffer(latestBuffer)) throw new Error("A verificação do backup RDF falhou; publicação cancelada.");

    const temporaryPath = `${rdfPath}.admin-${randomUUID()}.tmp`;
    const rollbackPath = `${rdfPath}.admin-${randomUUID()}.rollback`;
    await writeFile(temporaryPath, nextBuffer, { flag: "wx" });
    let originalMoved = false;
    try {
      await rename(rdfPath, rollbackPath);
      originalMoved = true;
      await rename(temporaryPath, rdfPath);
    } catch (error) {
      if (originalMoved) await rename(rollbackPath, rdfPath).catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    try {
      invalidateMobCatalogCache();
      const catalog = await loadMobCatalog();
      const offset = catalog.offsetByTblidx.get(draft.mobTblidx);
      if (offset === undefined) throw new Error("O mob sumiu do RDF depois da gravação.");
      const failed = diffMobSkillValues(readMobSkillValues(catalog.buffer, offset), draft.values);
      if (failed.length) throw new Error(`A verificação após a gravação falhou em: ${failed.join(", ")}.`);
    } catch (error) {
      await unlink(rdfPath).catch(() => undefined);
      await rename(rollbackPath, rdfPath);
      invalidateMobCatalogCache();
      throw error;
    }

    await unlink(rollbackPath);
    const relativeBackup = path.relative(process.cwd(), backupPath);
    const publishedDraft = await markPublished(draftId, administrator, relativeBackup);
    return {
      draft: publishedDraft, backupPath: relativeBackup, rdfPath,
      changes: context.changes, beforeHash: hashBuffer(latestBuffer), afterHash: hashBuffer(nextBuffer),
      warnings: context.warnings,
    };
  } finally {
    publicationInProgress = false;
  }
}
