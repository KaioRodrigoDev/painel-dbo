import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  describeDropUsage, DROP_BAG_OFFSETS, DROP_BAG_RECORD_SIZE, DROP_GROUP_OFFSETS, DROP_GROUP_RECORD_SIZE,
  DROP_HEADER_SIZE, findDropRecord, invalidateDropCatalogCache, resolveDropBagPath, resolveDropGroupPath,
} from "@/lib/drop-catalog";
import {
  diffDropValues, DROP_FIELDS, getDropDraft, markDropDraftPublished, maxSlots, SLOT_LABEL,
  toDraftValues, validateDropDraftValues, validateDropReferences,
} from "@/lib/drop-drafts";
import { loadItemCatalog } from "@/lib/item-catalog";
import { constantTimeEqual } from "@/lib/security";
import type { DropDraftValues, DropPublishChange, DropPublishPreview } from "@/lib/types";

let publicationInProgress = false;

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function createConfirmationToken(draftId: string, updatedAt: string, rdfHash: string, changes: DropPublishChange[]) {
  return createHash("sha256").update(JSON.stringify({ draftId, updatedAt, rdfHash, changes })).digest("hex");
}

export function dropTablePath(target: "group" | "bag") {
  return target === "bag" ? resolveDropBagPath() : resolveDropGroupPath();
}

function recordSize(target: "group" | "bag") {
  return target === "bag" ? DROP_BAG_RECORD_SIZE : DROP_GROUP_RECORD_SIZE;
}

function findRecordOffset(buffer: Buffer, target: "group" | "bag", tblidx: number) {
  const size = recordSize(target);
  if (buffer.length <= DROP_HEADER_SIZE || (buffer.length - DROP_HEADER_SIZE) % size !== 0) {
    throw new Error(`O formato atual do ${path.basename(dropTablePath(target))} é incompatível.`);
  }
  let found = -1;
  for (let offset = DROP_HEADER_SIZE; offset < buffer.length; offset += size) {
    if (buffer.readUInt32LE(offset) !== tblidx) continue;
    if (found !== -1) throw new Error(`O RDF contém mais de um registro com TBLIDX ${tblidx}.`);
    found = offset;
  }
  if (found === -1) throw new Error(`O registro ${tblidx} não existe mais no RDF atual.`);
  return found;
}

/**
 * Grava o registro inteiro, campos e posições.
 *
 * As posições saem compactadas: as preenchidas vão para o começo do array, o resto vira zero
 * e o contador recebe exatamente o número de posições usadas. É isso que impede de repetir o
 * defeito do grupo 333, que declara 30 bags num array de 20 e faz o GameServer ler fora dele.
 * `dwTotalProb` é recalculado como a soma; o servidor não o lê, mas deixá-lo desatualizado
 * faria a tabela mentir para quem a abrisse depois.
 */
function writeRecord(buffer: Buffer, offset: number, target: "group" | "bag", values: DropDraftValues) {
  const limit = maxSlots(target);
  if (values.slots.length > limit) throw new Error(`O registro aceita no máximo ${limit} posições.`);

  if (target === "bag") {
    buffer.writeUInt8(values.level, offset + DROP_BAG_OFFSETS.level);
    buffer.writeUInt8(values.enchantAble ? 1 : 0, offset + DROP_BAG_OFFSETS.enchantAble);
    for (let index = 0; index < limit; index += 1) {
      const slot = values.slots[index];
      buffer.writeUInt32LE(slot?.tblidx ?? 0, offset + DROP_BAG_OFFSETS.items + index * 4);
      buffer.writeUInt32LE(slot?.probability ?? 0, offset + DROP_BAG_OFFSETS.probabilities + index * 4);
    }
    buffer.writeUInt32LE(values.slots.length, offset + DROP_BAG_OFFSETS.count);
    buffer.writeUInt32LE(values.slots.reduce((total, slot) => total + slot.probability, 0), offset + DROP_BAG_OFFSETS.totalProbability);
    return;
  }

  buffer.writeUInt8(values.level, offset + DROP_GROUP_OFFSETS.level);
  buffer.writeUInt8(values.tryCount ?? 0, offset + DROP_GROUP_OFFSETS.tryCount);
  buffer.writeUInt32LE(values.superior ?? 0, offset + DROP_GROUP_OFFSETS.superior);
  buffer.writeUInt32LE(values.excellent ?? 0, offset + DROP_GROUP_OFFSETS.excellent);
  buffer.writeUInt32LE(values.rare ?? 0, offset + DROP_GROUP_OFFSETS.rare);
  buffer.writeUInt32LE(values.legendary ?? 0, offset + DROP_GROUP_OFFSETS.legendary);
  buffer.writeUInt32LE(values.zenny ?? 0, offset + DROP_GROUP_OFFSETS.zenny);
  for (let index = 0; index < limit; index += 1) {
    const slot = values.slots[index];
    buffer.writeUInt32LE(slot?.tblidx ?? 0, offset + DROP_GROUP_OFFSETS.bags + index * 4);
    buffer.writeUInt32LE(slot?.probability ?? 0, offset + DROP_GROUP_OFFSETS.probabilities + index * 4);
  }
  buffer.writeUInt32LE(values.slots.length, offset + DROP_GROUP_OFFSETS.count);
  buffer.writeUInt32LE(values.slots.reduce((total, slot) => total + slot.probability, 0), offset + DROP_GROUP_OFFSETS.totalProbability);
}

async function describeSlot(target: "group" | "bag", slot: { tblidx: number; probability: number } | undefined) {
  if (!slot) return "vazia";
  if (target === "bag") {
    const catalog = await loadItemCatalog();
    const item = catalog.items.find((entry) => entry.tblidx === slot.tblidx);
    return `${item?.name ?? "item desconhecido"} (#${slot.tblidx}) · ${slot.probability}%`;
  }
  const bag = await findDropRecord("bag", slot.tblidx);
  return `${bag?.name ?? "bag desconhecida"} (#${slot.tblidx}) · ${slot.probability}%`;
}

async function publicationContext(draftId: string) {
  const draft = await getDropDraft(draftId);
  const rdfPath = dropTablePath(draft.target);
  const rdfBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
  const rdfHash = hashBuffer(rdfBuffer);

  const blockingIssues: string[] = [];
  if (draft.status !== "draft") blockingIssues.push("Este rascunho já foi publicado.");
  try { validateDropDraftValues(draft.target, draft.values); }
  catch (error) { blockingIssues.push(error instanceof Error ? error.message : "Os valores do rascunho são inválidos."); }
  blockingIssues.push(...(await validateDropReferences(draft.target, draft.values)));

  // O diff sai contra o RDF de agora, nao contra o snapshot do rascunho: entre salvar e
  // publicar o arquivo pode ter mudado por fora, e publicar o snapshot antigo desfaria isso
  // sem avisar.
  const record = await findDropRecord(draft.target, draft.tblidx);
  if (!record) {
    blockingIssues.push(`O registro ${draft.tblidx} não existe mais na tabela.`);
    return { draft, rdfPath, rdfBuffer, rdfHash, currentValues: null, changes: [], warnings: [], blockingIssues, confirmationToken: null };
  }
  const currentValues = toDraftValues(draft.target, record);
  const changedIds = diffDropValues(draft.target, currentValues, draft.values);
  const fields: Record<string, { label: string }> = DROP_FIELDS[draft.target];

  const changes: DropPublishChange[] = [];
  for (const id of changedIds) {
    if (id.startsWith("slot.")) {
      const index = Number(id.slice(5));
      changes.push({
        id, label: `${SLOT_LABEL[draft.target]} na posição ${index + 1}`,
        before: await describeSlot(draft.target, currentValues.slots[index]),
        after: await describeSlot(draft.target, draft.values.slots[index]),
      });
      continue;
    }
    const label = id === "enchantAble" ? "Encantável" : fields[id]?.label ?? id;
    const before = (currentValues as Record<string, unknown>)[id];
    const after = (draft.values as Record<string, unknown>)[id];
    changes.push({ id, label, before: String(before), after: String(after) });
  }

  if (!changes.length) blockingIssues.push("O RDF atual já possui todos os valores deste rascunho.");

  const usage = await describeDropUsage(draft.target, draft.tblidx);
  const warnings = [
    `A publicação grava direto em ${path.basename(rdfPath)}, na pasta de tabelas do servidor.`,
    "O GameServer precisa ser reiniciado para recarregar a tabela; não existe comando de recarga.",
    "O cliente não lê estas tabelas, então nenhum pack precisa ser regerado.",
  ];
  if (draft.target === "bag" && usage.groups.length > 1) {
    warnings.unshift(`Esta bag é usada por ${usage.groups.length} grupos. A mudança vale para todos eles de uma vez.`);
  }
  if (usage.reachesWholeRegion) {
    warnings.unshift("Algum grupo afetado distribui drop por regra de mundo ou tipo de mob, então isso alcança muitos mobs, não só os listados.");
  }

  const confirmationToken = blockingIssues.length ? null : createConfirmationToken(draftId, draft.updatedAt, rdfHash, changes);
  return { draft, rdfPath, rdfBuffer, rdfHash, currentValues, changes, warnings, blockingIssues, confirmationToken, usage };
}

export async function getDropPublishPreview(draftId: string): Promise<DropPublishPreview> {
  const context = await publicationContext(draftId);
  return {
    draftId, target: context.draft.target, tblidx: context.draft.tblidx, name: context.draft.name,
    rdfPath: context.rdfPath, changes: context.changes, warnings: context.warnings,
    blockingIssues: context.blockingIssues, confirmationToken: context.confirmationToken,
    usage: context.usage ?? { groups: [], mobs: [], reachesWholeRegion: false },
  };
}

export async function publishDropDraft(draftId: string, confirmationToken: string, administrator: string) {
  if (publicationInProgress) throw new Error("Outra publicação de drop está em andamento.");
  publicationInProgress = true;
  try {
    const context = await publicationContext(draftId);
    if (context.blockingIssues.length || !context.confirmationToken) throw new Error(context.blockingIssues.join(" ") || "O rascunho não pode ser publicado.");
    if (!constantTimeEqual(confirmationToken, context.confirmationToken)) throw new Error("A confirmação expirou porque o rascunho ou o RDF mudou. Valide novamente.");

    const { draft, rdfPath } = context;
    const latestBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
    const latestToken = createConfirmationToken(draftId, draft.updatedAt, hashBuffer(latestBuffer), context.changes);
    if (!constantTimeEqual(confirmationToken, latestToken)) throw new Error("O RDF mudou após a validação. Valide novamente antes de publicar.");

    const recordOffset = findRecordOffset(latestBuffer, draft.target, draft.tblidx);
    const nextBuffer = Buffer.from(latestBuffer);
    writeRecord(nextBuffer, recordOffset, draft.target, draft.values);
    if (nextBuffer.length !== latestBuffer.length) throw new Error("A gravação alterou o tamanho do arquivo; publicação cancelada.");

    const backupDirectory = path.join(process.cwd(), "data", "drop-rdf-backups");
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `${path.basename(rdfPath)}.${stamp}.before-${draftId}.rdf`);
    await copyFile(rdfPath, backupPath, fsConstants.COPYFILE_EXCL);
    if (hashBuffer(await readFile(backupPath)) !== hashBuffer(latestBuffer)) throw new Error("A verificação do backup RDF falhou; publicação cancelada.");

    // Troca por rename para o GameServer nunca enxergar um arquivo pela metade, e com o
    // original guardado ao lado para voltar se a verificacao de leitura falhar.
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
      invalidateDropCatalogCache();
      const updated = await findDropRecord(draft.target, draft.tblidx);
      if (!updated) throw new Error("O registro sumiu do RDF depois da gravação.");
      const updatedValues = toDraftValues(draft.target, updated);
      const failed = diffDropValues(draft.target, updatedValues, draft.values);
      if (failed.length) throw new Error(`A verificação após a gravação falhou em: ${failed.join(", ")}.`);
    } catch (error) {
      await unlink(rdfPath).catch(() => undefined);
      await rename(rollbackPath, rdfPath);
      invalidateDropCatalogCache();
      throw error;
    }

    await unlink(rollbackPath);
    const relativeBackup = path.relative(process.cwd(), backupPath);
    const publishedDraft = await markDropDraftPublished(draftId, administrator, relativeBackup);
    return {
      draft: publishedDraft,
      backupPath: relativeBackup,
      rdfPath,
      changes: context.changes,
      beforeHash: hashBuffer(latestBuffer),
      afterHash: hashBuffer(nextBuffer),
      warnings: context.warnings,
    };
  } finally {
    publicationInProgress = false;
  }
}
