import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getSkillCreationBaseValues, SKILL_CREATION_FIELDS, type SkillCreationFieldId } from "@/lib/skill-creation-definitions";
import { invalidateSkillCatalogCache, loadSkillCatalog, resolveSkillCatalogPath, SKILL_RDF_HEADER_SIZE, SKILL_RDF_RECORD_SIZE } from "@/lib/skill-catalog";
import { getSkillDraft, markSkillDraftPublished, validateSkillDraftValues } from "@/lib/skill-drafts";
import {
  applySkillPackChanges,
  defaultClientPackDirectory,
  prepareSkillPackDownload,
  resolveRequestedPackDirectory,
  restoreSkillPackBackup,
  type SkillPackFieldWriter,
  type SkillPackWriteResult,
} from "@/lib/skill-pack-publisher";
import { constantTimeEqual } from "@/lib/security";
import type { SkillDraft, SkillDraftValue, SkillPublishChange, SkillPublishPreview } from "@/lib/types";

type FieldWriter = (buffer: Buffer, recordOffset: number, value: SkillDraftValue) => void;

const numberValue = (value: SkillDraftValue) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Valor numérico inválido durante a publicação.");
  return value;
};
const booleanValue = (value: SkillDraftValue) => {
  if (typeof value !== "boolean") throw new Error("Valor booleano inválido durante a publicação.");
  return value;
};
const numberList = (value: SkillDraftValue, length: number) => {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => !Number.isFinite(entry))) throw new Error("Lista numérica inválida durante a publicação.");
  return value;
};

const byte = (offset: number): FieldWriter => (buffer, recordOffset, value) => buffer.writeUInt8(numberValue(value), recordOffset + offset);
const bool = (offset: number): FieldWriter => (buffer, recordOffset, value) => buffer.writeUInt8(booleanValue(value) ? 1 : 0, recordOffset + offset);
const word = (offset: number): FieldWriter => (buffer, recordOffset, value) => buffer.writeUInt16LE(numberValue(value), recordOffset + offset);
const dword = (offset: number): FieldWriter => (buffer, recordOffset, value) => buffer.writeUInt32LE(numberValue(value), recordOffset + offset);
const float = (offset: number): FieldWriter => (buffer, recordOffset, value) => buffer.writeFloatLE(numberValue(value), recordOffset + offset);

const FIELD_WRITERS: Partial<Record<SkillCreationFieldId, FieldWriter>> = {
  internalName: (buffer, recordOffset, value) => {
    if (typeof value !== "string") throw new Error("Nome interno inválido.");
    const encoded = Buffer.from(value, "utf16le");
    if (encoded.length > 80) throw new Error("Nome interno ultrapassa 40 caracteres UTF-16.");
    buffer.fill(0, recordOffset + 8, recordOffset + 90);
    encoded.copy(buffer, recordOffset + 8);
  },
  valid: bool(90), classFlag: dword(92), classType: byte(96), skillClass: byte(97), skillType: byte(98), activeType: byte(99),
  buffGroup: byte(100), slotIndex: byte(101), grade: byte(102), functionFlag: dword(104), appointTarget: byte(108), applyTarget: byte(109),
  applyTargetMax: byte(110), applyRange: byte(111), applyAreaSize1: byte(112), applyAreaSize2: byte(113),
  effectIds: (buffer, recordOffset, value) => numberList(value, 2).forEach((entry, index) => buffer.writeUInt32LE(entry, recordOffset + 116 + index * 4)),
  effectTypes: (buffer, recordOffset, value) => numberList(value, 2).forEach((entry, index) => buffer.writeUInt8(entry, recordOffset + 124 + index)),
  effectValues: (buffer, recordOffset, value) => numberList(value, 2).forEach((entry, index) => buffer.writeDoubleLE(entry, recordOffset + 128 + index * 8)),
  additionalAggro: dword(144),
  rpEffects: (buffer, recordOffset, value) => numberList(value, 6).forEach((entry, index) => buffer.writeUInt8(entry, recordOffset + 148 + index)),
  rpEffectValues: (buffer, recordOffset, value) => numberList(value, 6).forEach((entry, index) => buffer.writeFloatLE(entry, recordOffset + 156 + index * 4)),
  requiredLevel: byte(180), requiredZenny: dword(184), requiredSp: word(190), selfTrain: bool(192),
  prerequisiteSkillIds: (buffer, recordOffset, value) => numberList(value, 4).forEach((entry, index) => buffer.writeUInt32LE(entry, recordOffset + 196 + index * 4)),
  rootSkillId: dword(212), requiredEquipSlotType: byte(216), requiredItemType: byte(217),
  iconName: (buffer, recordOffset, value) => {
    if (typeof value !== "string" || !/^[\x20-\x7e]*$/.test(value) || Buffer.byteLength(value, "latin1") > 32) throw new Error("O nome do ícone deve conter até 32 caracteres ASCII.");
    buffer.fill(0, recordOffset + 218, recordOffset + 251);
    Buffer.from(value, "latin1").copy(buffer, recordOffset + 218);
  },
  requiredLp: dword(252), requiredEp: word(256), requiredRpBalls: byte(258),
  castingTimeMs: (buffer, recordOffset, value) => {
    const milliseconds = numberValue(value);
    buffer.writeFloatLE(milliseconds / 1000, recordOffset + 260);
    buffer.writeUInt32LE(milliseconds, recordOffset + 264);
  },
  cooldownMs: (buffer, recordOffset, value) => {
    const milliseconds = numberValue(value);
    buffer.writeUInt16LE(milliseconds / 1000, recordOffset + 268);
    buffer.writeUInt32LE(milliseconds, recordOffset + 272);
  },
  keepTimeMs: (buffer, recordOffset, value) => {
    const milliseconds = numberValue(value);
    buffer.writeUInt16LE(milliseconds / 1000, recordOffset + 276);
    buffer.writeUInt32LE(milliseconds, recordOffset + 280);
  },
  keepEffect: bool(284),
  useRangeMin: (buffer, recordOffset, value) => { const range = numberValue(value); buffer.writeUInt8(range, recordOffset + 285); buffer.writeFloatLE(range, recordOffset + 288); },
  useRangeMax: (buffer, recordOffset, value) => { const range = numberValue(value); buffer.writeUInt8(range, recordOffset + 292); buffer.writeFloatLE(range, recordOffset + 296); },
  nextSkillId: dword(304), defaultDisplayOff: bool(308), animationTimeMs: dword(312), castingAnimationStart: word(316),
  castingAnimationLoop: word(318), actionAnimation: word(320), actionLoopAnimation: word(322), actionEndAnimation: word(324), dashAble: bool(326),
  successRate: float(332), classChange: byte(336), useType: byte(337), skillGroup: byte(338), requiredVp: dword(340), restrictionRuleFlag: dword(344),
};

let publicationInProgress = false;

function sameValue(left: SkillDraftValue | undefined, right: SkillDraftValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function createConfirmationToken(draft: SkillDraft, rdfHash: string, changes: SkillPublishChange[]) {
  return createHash("sha256").update(JSON.stringify({ draftId: draft.id, updatedAt: draft.updatedAt, rdfHash, changes })).digest("hex");
}

function findRecordOffset(buffer: Buffer, tblidx: number) {
  if (buffer.length <= SKILL_RDF_HEADER_SIZE || (buffer.length - SKILL_RDF_HEADER_SIZE) % SKILL_RDF_RECORD_SIZE !== 0) throw new Error("O formato atual do Table_Skill_Data.rdf é incompatível.");
  let found = -1;
  for (let offset = SKILL_RDF_HEADER_SIZE; offset < buffer.length; offset += SKILL_RDF_RECORD_SIZE) {
    if (buffer.readUInt32LE(offset) !== tblidx) continue;
    if (found !== -1) throw new Error(`O RDF contém mais de um registro com TBLIDX ${tblidx}.`);
    found = offset;
  }
  if (found === -1) throw new Error(`A skill ${tblidx} não existe mais no RDF atual.`);
  return found;
}

function validateEffectiveValues(values: Record<string, SkillDraftValue>, changedIds: string[]) {
  const issues: string[] = [];
  const applyRange = Number(values.applyRange);
  if (!Number.isInteger(applyRange) || applyRange < 0 || applyRange > 6) issues.push("Formato da área deve estar entre 0 e 6.");
  if (applyRange === 1 && Number(values.applyAreaSize1) <= 0) issues.push("Uma área circular precisa de Área 1 maior que zero.");
  if (Number(values.applyTargetMax) < 1) issues.push("Máximo de alvos deve ser pelo menos 1.");
  for (const id of ["cooldownMs", "keepTimeMs"]) {
    if (changedIds.includes(id) && Number(values[id]) % 1000 !== 0) issues.push(`${SKILL_CREATION_FIELDS[id as SkillCreationFieldId].label} deve usar segundos inteiros nesta estrutura RDF.`);
  }
  for (const id of ["useRangeMin", "useRangeMax"]) {
    if (changedIds.includes(id) && (!Number.isInteger(Number(values[id])) || Number(values[id]) < 0 || Number(values[id]) > 255)) issues.push(`${SKILL_CREATION_FIELDS[id as SkillCreationFieldId].label} deve ser um inteiro entre 0 e 255 nesta estrutura RDF.`);
  }
  return issues;
}

async function publicationContext(draftId: string) {
  const draft = await getSkillDraft(draftId);
  const rdfPath = resolveSkillCatalogPath();
  const rdfBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
  const rdfHash = hashBuffer(rdfBuffer);
  findRecordOffset(rdfBuffer, draft.newTblidx);

  const catalog = await loadSkillCatalog();
  const currentSkill = catalog.skills.find((skill) => skill.tblidx === draft.newTblidx);
  if (!currentSkill) throw new Error("A skill não foi encontrada no catálogo atual.");
  const currentValues = getSkillCreationBaseValues(currentSkill);
  const changes: SkillPublishChange[] = [];
  const blockingIssues: string[] = [];

  if ((draft.operation ?? "create") !== "edit") blockingIssues.push("A publicação de novas skills ainda não é suportada; somente edições de registros existentes.");
  if (draft.status !== "draft") blockingIssues.push("Este rascunho já foi publicado.");
  if (draft.baseTblidx !== draft.newTblidx || draft.values.tblidx !== draft.newTblidx) blockingIssues.push("Uma edição não pode alterar o TBLIDX original.");
  if (currentSkill.skillClass !== draft.skillClass) blockingIssues.push("A categoria da skill no RDF não corresponde ao rascunho.");
  try { validateSkillDraftValues(draft.skillClass, draft.values); }
  catch (error) { blockingIssues.push(error instanceof Error ? error.message : "Os valores do rascunho são inválidos."); }

  for (const id of [...new Set(draft.changedFields)]) {
    const metadata = SKILL_CREATION_FIELDS[id as SkillCreationFieldId];
    if (!metadata) { blockingIssues.push(`Campo desconhecido no rascunho: ${id}.`); continue; }
    const before = currentValues[id];
    const after = draft.values[id];
    if (sameValue(before, after)) continue;
    changes.push({ id, label: metadata.label, sourceField: metadata.sourceField, before, after });
    if (!FIELD_WRITERS[id as SkillCreationFieldId]) blockingIssues.push(`${metadata.label} não pertence ao Table_Skill_Data.rdf publicável nesta etapa.`);
  }

  if (!changes.length) blockingIssues.push("O RDF atual já possui todos os valores deste rascunho.");
  const effectiveValues = { ...currentValues, ...Object.fromEntries(changes.map((change) => [change.id, change.after])) };
  blockingIssues.push(...validateEffectiveValues(effectiveValues, changes.map((change) => change.id)));
  const warnings = [
    "A publicação grava no Table_Skill_Data.rdf do servidor e na cópia que o cliente lê de dentro do pack.",
    "O GameServer precisa ser reiniciado depois da publicação para recarregar a tabela.",
    "Os jogadores só passam a ver a mudança depois de baixar o pack atualizado e substituí-lo na pasta pack do cliente.",
  ];
  const confirmationToken = blockingIssues.length ? null : createConfirmationToken(draft, rdfHash, changes);
  return { draft, rdfPath, rdfBuffer, rdfHash, changes, warnings, blockingIssues, confirmationToken, effectiveValues };
}

export async function getSkillPublishPreview(draftId: string): Promise<SkillPublishPreview> {
  const context = await publicationContext(draftId);
  return { draftId, tblidx: context.draft.newTblidx, skillName: context.draft.name, rdfPath: context.rdfPath, changes: context.changes, warnings: context.warnings, blockingIssues: context.blockingIssues, confirmationToken: context.confirmationToken, defaultClientPackDirectory: defaultClientPackDirectory() };
}

export type SkillPublishOptions = {
  /** Substituir o pack do cliente na pasta escolhida, guardando backup. */
  replaceClientPack: boolean;
  /** Pasta pack do cliente. Vazio usa a configurada em CLIENT_PACK_DIRECTORY. */
  clientPackDirectory?: string | null;
  /** Gerar uma cópia já corrigida do pack para download. */
  prepareDownload: boolean;
};

export async function publishSkillDraft(draftId: string, confirmationToken: string, administrator: string, options: SkillPublishOptions) {
  if (publicationInProgress) throw new Error("Outra publicação de skill está em andamento.");
  publicationInProgress = true;
  try {
    const context = await publicationContext(draftId);
    if (context.blockingIssues.length || !context.confirmationToken) throw new Error(context.blockingIssues.join(" ") || "O rascunho não pode ser publicado.");
    if (!constantTimeEqual(confirmationToken, context.confirmationToken)) throw new Error("A confirmação expirou porque o rascunho ou o RDF mudou. Valide novamente.");

    const latestBuffer = await readFile(/* turbopackIgnore: true */ context.rdfPath);
    const latestToken = createConfirmationToken(context.draft, hashBuffer(latestBuffer), context.changes);
    if (!constantTimeEqual(confirmationToken, latestToken)) throw new Error("O RDF mudou após a validação. Valide novamente antes de publicar.");
    const recordOffset = findRecordOffset(latestBuffer, context.draft.newTblidx);
    const nextBuffer = Buffer.from(latestBuffer);
    for (const change of context.changes) FIELD_WRITERS[change.id as SkillCreationFieldId]!(nextBuffer, recordOffset, change.after);

    // As etapas do pack vao primeiro: dependem de arquivos externos ao repositorio, entao
    // falhar aqui aborta antes de encostar no RDF do servidor. Se o RDF falhar depois, o
    // pack substituido volta pelo backup -- as duas copias nunca divergem, que e
    // justamente o que faz uma skill parecer publicada sem funcionar no jogo.
    const { replaced, download } = await publishSkillPacks(context.draft.newTblidx, context.changes, draftId, options);
    try {
      return await writeSkillRdf(context, draftId, administrator, latestBuffer, nextBuffer, replaced, download);
    } catch (error) {
      if (replaced?.backupPath) await restoreSkillPackBackup(replaced.packPath, replaced.backupPath).catch(() => undefined);
      throw error;
    }
  } finally {
    publicationInProgress = false;
  }
}

export function skillPackDownloadDirectory(draftId: string) {
  return path.join(process.cwd(), "data", "client-pack-downloads", draftId);
}

/** Executa as etapas de pack escolhidas pelo operador na hora de publicar. */
async function publishSkillPacks(tblidx: number, changes: SkillPublishChange[], draftId: string, options: SkillPublishOptions) {
  if (!options.replaceClientPack && !options.prepareDownload) return { replaced: null, download: null };

  const directory = await resolveRequestedPackDirectory(options.clientPackDirectory);
  const writeFields: SkillPackFieldWriter = (buffer, recordOffset) => {
    for (const change of changes) FIELD_WRITERS[change.id as SkillCreationFieldId]!(buffer, recordOffset, change.after);
  };

  const replaced = options.replaceClientPack
    ? await applySkillPackChanges(tblidx, writeFields, { backupDirectory: path.join(process.cwd(), "data", "skill-pack-backups"), label: draftId, directory })
    : null;

  // Quando a substituicao ja rodou, a copia sai do arquivo corrigido e a segunda
  // gravacao vira no-op; quando nao rodou, a copia e o unico lugar que recebe a mudanca.
  const download = options.prepareDownload
    ? await prepareSkillPackDownload(tblidx, writeFields, { outputDirectory: skillPackDownloadDirectory(draftId), directory })
    : null;

  return { replaced, download };
}

async function writeSkillRdf(
  context: Awaited<ReturnType<typeof publicationContext>>,
  draftId: string,
  administrator: string,
  latestBuffer: Buffer,
  nextBuffer: Buffer,
  replaced: SkillPackWriteResult | null,
  download: SkillPackWriteResult | null,
) {
  {
    const backupDirectory = path.join(process.cwd(), "data", "skill-rdf-backups");
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `Table_Skill_Data.${stamp}.before-${draftId}.rdf`);
    await copyFile(context.rdfPath, backupPath, fsConstants.COPYFILE_EXCL);
    if (hashBuffer(await readFile(backupPath)) !== hashBuffer(latestBuffer)) throw new Error("A verificação do backup RDF falhou; publicação cancelada.");

    const temporaryPath = `${context.rdfPath}.admin-${randomUUID()}.tmp`;
    const rollbackPath = `${context.rdfPath}.admin-${randomUUID()}.rollback`;
    await writeFile(temporaryPath, nextBuffer, { flag: "wx" });
    let originalMoved = false;
    try {
      await rename(context.rdfPath, rollbackPath);
      originalMoved = true;
      await rename(temporaryPath, context.rdfPath);
    } catch (error) {
      if (originalMoved) await rename(rollbackPath, context.rdfPath).catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    try {
      invalidateSkillCatalogCache();
      const updatedCatalog = await loadSkillCatalog();
      const updatedSkill = updatedCatalog.skills.find((skill) => skill.tblidx === context.draft.newTblidx);
      const updatedValues = updatedSkill ? getSkillCreationBaseValues(updatedSkill) : {};
      const failed = context.changes.filter((change) => !sameValue(updatedValues[change.id], change.after));
      if (failed.length) throw new Error(`A verificação após a gravação falhou nos campos: ${failed.map((change) => change.label).join(", ")}.`);
    } catch (error) {
      await unlink(context.rdfPath).catch(() => undefined);
      await rename(rollbackPath, context.rdfPath);
      invalidateSkillCatalogCache();
      throw error;
    }

    await unlink(rollbackPath);
    const relativeBackup = path.relative(process.cwd(), backupPath);
    const publishedDraft = await markSkillDraftPublished(draftId, administrator, relativeBackup);
    return {
      draft: publishedDraft,
      backupPath: relativeBackup,
      rdfPath: context.rdfPath,
      changes: context.changes,
      beforeHash: context.rdfHash,
      afterHash: hashBuffer(nextBuffer),
      warnings: context.warnings,
      clientPack: {
        replaced: replaced
          ? {
              fileName: replaced.packFileName,
              packPath: replaced.packPath,
              backupPath: replaced.backupPath ? path.relative(process.cwd(), replaced.backupPath) : null,
              beforeHash: replaced.beforeHash,
              afterHash: replaced.afterHash,
            }
          : null,
        download: download ? { fileName: download.packFileName, draftId, sha256: download.afterHash } : null,
      },
    };
  }
}
