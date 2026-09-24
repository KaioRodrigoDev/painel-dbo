import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { findDropRecord, MAX_BAGS_PER_GROUP, MAX_ITEMS_PER_BAG, type RawBag, type RawGroup } from "@/lib/drop-catalog";
import { loadItemCatalog } from "@/lib/item-catalog";
import type { DropDraft, DropDraftValues, DropSlot } from "@/lib/types";

const DRAFT_DIRECTORY = path.join(process.cwd(), "data", "drop-drafts");

/**
 * Os campos que o editor grava, por tipo de registro.
 *
 * Fora desta lista ficam, de proposito, `mob_Index`, `dwMob_Type` e `dwWorld_Rule_Type`. Eles
 * decidem QUAIS mobs alcancam o grupo; mudar um deles nao edita um drop, realoca o grupo
 * inteiro para outro publico -- e como um grupo so pode pertencer a um mob, mexer ali tira o
 * drop de quem tinha. Enquanto nao existir criacao de registro, mover e sempre destrutivo.
 */
export const DROP_FIELDS = {
  group: {
    level: { label: "Nível do grupo", min: 0, max: 255 },
    tryCount: { label: "Tentativas por morte", min: 0, max: 255 },
    zenny: { label: "Zeni do grupo", min: 0, max: 4294967295 },
    superior: { label: "Superior (valor bruto)", min: 0, max: 10000 },
    excellent: { label: "Excelente (valor bruto)", min: 0, max: 10000 },
    rare: { label: "Raro (valor bruto)", min: 0, max: 10000 },
    legendary: { label: "Lendário (valor bruto)", min: 0, max: 10000 },
  },
  bag: {
    level: { label: "Nível da bag", min: 0, max: 255 },
  },
} as const;

export const SLOT_LABEL = { group: "Bag", bag: "Item" } as const;

export function maxSlots(target: "group" | "bag") {
  return target === "bag" ? MAX_ITEMS_PER_BAG : MAX_BAGS_PER_GROUP;
}

/**
 * O registro cru virando o formato do formulario.
 *
 * As posicoes vazias somem aqui e voltam compactadas na gravacao. O servidor percorre
 * `for (i = 0; i < contador; i++)` sobre o array, entao um buraco no meio faz ele processar
 * uma posicao zerada -- e uma posicao preenchida depois do contador nunca e lida.
 */
export function toDraftValues(target: "group" | "bag", record: RawGroup | RawBag): DropDraftValues {
  const limit = maxSlots(target);
  const ids = target === "bag" ? (record as RawBag).items : (record as RawGroup).bags;
  const declared = target === "bag" ? (record as RawBag).declaredItemCount : (record as RawGroup).declaredBagCount;
  const slots: DropSlot[] = [];
  for (let index = 0; index < Math.min(declared, limit); index += 1) {
    const tblidx = ids[index];
    if (!tblidx || tblidx === 0xffffffff) continue;
    slots.push({ tblidx, probability: record.probabilities[index] });
  }

  if (target === "bag") {
    const bag = record as RawBag;
    return { level: bag.level, enchantAble: bag.enchantAble, slots };
  }
  const group = record as RawGroup;
  return {
    level: group.level, tryCount: group.tryCount, zenny: group.zenny,
    superior: group.superior, excellent: group.excellent, rare: group.rare, legendary: group.legendary,
    slots,
  };
}

export function validateDropDraftValues(target: "group" | "bag", values: DropDraftValues) {
  const fields: Record<string, { label: string; min: number; max: number }> = DROP_FIELDS[target];
  for (const [id, metadata] of Object.entries(fields)) {
    const value = (values as Record<string, unknown>)[id];
    if (!Number.isInteger(value)) throw new Error(`${metadata.label} deve ser um número inteiro.`);
    const numeric = value as number;
    if (numeric < metadata.min || numeric > metadata.max) throw new Error(`${metadata.label} deve ficar entre ${metadata.min} e ${metadata.max}.`);
  }
  if (target === "bag" && typeof values.enchantAble !== "boolean") throw new Error("Encantável deve ser verdadeiro ou falso.");

  const limit = maxSlots(target);
  if (!Array.isArray(values.slots)) throw new Error("Lista de posições inválida.");
  if (values.slots.length > limit) throw new Error(`O registro aceita no máximo ${limit} posições.`);
  if (values.slots.length === 0) throw new Error(`Deixe pelo menos uma posição preenchida; um registro vazio nunca larga nada.`);

  for (const [index, slot] of values.slots.entries()) {
    const position = index + 1;
    if (!Number.isInteger(slot.tblidx) || slot.tblidx < 1 || slot.tblidx > 4294967294) throw new Error(`Posição ${position}: TBLIDX inválido.`);
    // Dbo_CheckProbabilityF sorteia em 0..100 e trata <= 0 como nunca. Acima de 100 e sempre,
    // o que e valido mas quase sempre engano, entao o limite fica no que a funcao enxerga.
    if (!Number.isInteger(slot.probability) || slot.probability < 1 || slot.probability > 100) throw new Error(`Posição ${position}: a probabilidade deve ser um inteiro de 1 a 100.`);
  }
}

/** Confere que todo tblidx referenciado existe, para não publicar uma posição morta. */
export async function validateDropReferences(target: "group" | "bag", values: DropDraftValues) {
  const issues: string[] = [];
  if (target === "bag") {
    const catalog = await loadItemCatalog();
    const known = new Set(catalog.items.map((item) => item.tblidx));
    for (const [index, slot] of values.slots.entries()) {
      if (!known.has(slot.tblidx)) issues.push(`Posição ${index + 1}: o item ${slot.tblidx} não existe em Table_Item_Data.rdf.`);
    }
    return issues;
  }
  for (const [index, slot] of values.slots.entries()) {
    if (!(await findDropRecord("bag", slot.tblidx))) issues.push(`Posição ${index + 1}: a bag ${slot.tblidx} não existe em table_item_bag_list_data.rdf.`);
  }
  return issues;
}

function sameValue(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }

/** Ids dos campos que mudaram, com as posições viradas em `slot.0`, `slot.1`... */
export function diffDropValues(target: "group" | "bag", before: DropDraftValues, after: DropDraftValues) {
  const changed: string[] = [];
  for (const id of Object.keys(DROP_FIELDS[target])) {
    if (!sameValue((before as Record<string, unknown>)[id], (after as Record<string, unknown>)[id])) changed.push(id);
  }
  if (target === "bag" && before.enchantAble !== after.enchantAble) changed.push("enchantAble");
  const slotCount = Math.max(before.slots.length, after.slots.length);
  for (let index = 0; index < slotCount; index += 1) {
    if (!sameValue(before.slots[index], after.slots[index])) changed.push(`slot.${index}`);
  }
  return changed;
}

export async function listDropDrafts() {
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const files = (await readdir(DRAFT_DIRECTORY)).filter((file) => /^[a-f0-9-]+\.json$/i.test(file));
  const drafts: DropDraft[] = [];
  for (const file of files) {
    try { drafts.push(JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, file), "utf8")) as DropDraft); }
    catch (error) { console.error(`Rascunho de drop inválido: ${file}`, error); }
  }
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getDropDraft(draftId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) throw new Error("Identificador de rascunho inválido.");
  try { return JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), "utf8")) as DropDraft; }
  catch { throw new Error("Rascunho de drop não encontrado."); }
}

export async function markDropDraftPublished(draftId: string, administrator: string, backupPath: string) {
  const draft = await getDropDraft(draftId);
  const published: DropDraft = { ...draft, status: "published", publishedAt: new Date().toISOString(), publishedBy: administrator, publicationBackup: backupPath };
  await writeFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), `${JSON.stringify(published, null, 2)}\n`, "utf8");
  return published;
}

export type CreateDropDraftInput = {
  target: "group" | "bag";
  tblidx: number;
  values: DropDraftValues;
};

export async function createDropDraft(input: CreateDropDraftInput, administrator: string) {
  validateDropDraftValues(input.target, input.values);
  const record = await findDropRecord(input.target, input.tblidx);
  if (!record) throw new Error(`O registro ${input.tblidx} não existe na tabela de ${input.target === "bag" ? "bags" : "grupos"}.`);

  const baseValues = toDraftValues(input.target, record);
  const changedFields = diffDropValues(input.target, baseValues, input.values);
  if (!changedFields.length) throw new Error("Altere pelo menos um campo antes de salvar o rascunho.");

  const referenceIssues = await validateDropReferences(input.target, input.values);
  if (referenceIssues.length) throw new Error(referenceIssues.join(" "));

  const openDrafts = (await listDropDrafts()).filter((draft) => draft.status === "draft" && draft.target === input.target && draft.tblidx === input.tblidx);
  if (openDrafts.length) throw new Error("Já existe um rascunho aberto para este registro. Publique ou descarte antes de criar outro.");

  const now = new Date().toISOString();
  const draft: DropDraft = {
    id: randomUUID(), status: "draft", target: input.target, tblidx: input.tblidx,
    name: record.name || `${input.target === "bag" ? "Bag" : "Grupo"} #${input.tblidx}`,
    values: input.values, baseValues, changedFields, administrator, createdAt: now, updatedAt: now,
  };

  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const target = path.join(DRAFT_DIRECTORY, `${draft.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return draft;
}

export async function deleteDropDraft(draftId: string) {
  const draft = await getDropDraft(draftId);
  if (draft.status === "published") throw new Error("Um rascunho já publicado não pode ser descartado.");
  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(DRAFT_DIRECTORY, `${draftId}.json`));
  return draft;
}
