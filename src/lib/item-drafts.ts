import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getFieldsForItemType, getItemCreationBaseValues, getItemCreationDefinition, ITEM_CREATION_PROFILES } from "@/lib/item-creation-definitions";
import { loadItemCatalog } from "@/lib/item-catalog";
import type { ItemDraft, ItemDraftValue } from "@/lib/types";

const DRAFT_DIRECTORY = path.join(process.cwd(), "data", "item-drafts");

export type CreateItemDraftInput = {
  itemType: number;
  baseTblidx: number;
  newTblidx: number;
  name: string;
  values: Record<string, ItemDraftValue>;
};

function sameValue(left: ItemDraftValue | undefined, right: ItemDraftValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateValues(itemType: number, values: Record<string, ItemDraftValue>) {
  const fields = getFieldsForItemType(itemType);
  const allowed = new Set(fields.map((item) => item.id));
  const unknown = Object.keys(values).filter((key) => !allowed.has(key as never));
  if (unknown.length) throw new Error(`Campos não permitidos para a categoria: ${unknown.join(", ")}.`);

  for (const metadata of fields) {
    const value = values[metadata.id];
    const composite = ["scouterParts", "creationRanks", "revisions", "disassemble"].includes(metadata.id);
    if (metadata.required && (value === undefined || value === "")) {
      throw new Error(`O campo ${metadata.label} é obrigatório.`);
    }
    if (value === undefined || value === "") continue;
    if (metadata.control === "checkbox" && typeof value !== "boolean") {
      throw new Error(`O campo ${metadata.label} deve ser verdadeiro ou falso.`);
    }
    if (composite && (!Array.isArray(value) || value.some((entry) => !Number.isFinite(entry)))) {
      throw new Error(`O campo ${metadata.label} deve ser uma lista numérica.`);
    }
    if (!composite && Array.isArray(value)) {
      throw new Error(`O campo ${metadata.label} não aceita uma lista.`);
    }
    if (!composite && ["number", "select", "bitflag", "reference"].includes(metadata.control) && typeof value !== "number") {
      throw new Error(`O campo ${metadata.label} deve ser numérico.`);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`O campo ${metadata.label} não é um número válido.`);
      if (!["attackRangeBonus", "revisions"].includes(metadata.id) && !Number.isInteger(value)) throw new Error(`${metadata.label} deve ser inteiro.`);
      if (metadata.min !== undefined && value < metadata.min) throw new Error(`${metadata.label} deve ser no mínimo ${metadata.min}.`);
      if (metadata.max !== undefined && value > metadata.max) throw new Error(`${metadata.label} deve ser no máximo ${metadata.max}.`);
    }
  }

  const textLimits: Record<string, number> = { name: 64, description: 2000, iconName: 32, modelName: 32, subWeaponModelName: 32 };
  for (const [key, limit] of Object.entries(textLimits)) {
    const value = values[key];
    if (typeof value === "string" && value.length > limit) throw new Error(`${key} ultrapassa ${limit} caracteres.`);
  }
}

export async function listItemDrafts() {
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const files = (await readdir(DRAFT_DIRECTORY)).filter((file) => /^[a-f0-9-]+\.json$/i.test(file));
  const drafts: ItemDraft[] = [];
  for (const file of files) {
    try {
      drafts.push(JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, file), "utf8")) as ItemDraft);
    } catch (error) {
      console.error(`Rascunho de item inválido: ${file}`, error);
    }
  }
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createItemDraft(input: CreateItemDraftInput, administrator: string) {
  const definition = getItemCreationDefinition(input.itemType);
  if (!definition) throw new Error("Categoria de item não reconhecida.");
  validateValues(input.itemType, input.values);
  if (input.newTblidx < 1 || input.newTblidx > 4294967294 || !Number.isInteger(input.newTblidx)) throw new Error("Novo TBLIDX inválido.");
  if (input.values.tblidx !== input.newTblidx) throw new Error("O TBLIDX do formulário não corresponde ao novo item.");
  if (input.values.name !== input.name || !input.name.trim()) throw new Error("Nome do item inválido.");

  const catalog = await loadItemCatalog();
  const baseItem = catalog.items.find((item) => item.tblidx === input.baseTblidx);
  if (!baseItem || baseItem.itemType !== input.itemType) throw new Error("Item-base não pertence à categoria selecionada.");
  if (catalog.items.some((item) => item.tblidx === input.newTblidx)) throw new Error("O novo TBLIDX já existe no catálogo.");
  const existingDrafts = await listItemDrafts();
  if (existingDrafts.some((draft) => draft.newTblidx === input.newTblidx)) throw new Error("Já existe um rascunho com esse TBLIDX.");

  const baseValues = getItemCreationBaseValues(baseItem);
  const changedFields = getFieldsForItemType(input.itemType)
    .map((field) => field.id)
    .filter((fieldId) => !sameValue(input.values[fieldId], baseValues[fieldId]));
  const now = new Date().toISOString();
  const draft: ItemDraft = {
    id: randomUUID(),
    status: "draft",
    itemType: input.itemType,
    profile: ITEM_CREATION_PROFILES[definition.profile].label,
    baseTblidx: baseItem.tblidx,
    baseName: baseItem.name,
    newTblidx: input.newTblidx,
    name: input.name.trim(),
    values: input.values,
    changedFields,
    administrator,
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const target = path.join(DRAFT_DIRECTORY, `${draft.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return draft;
}
