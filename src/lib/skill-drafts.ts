import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getFieldsForSkillClass, getSkillCreationBaseValues, getSkillCreationProfile } from "@/lib/skill-creation-definitions";
import { loadSkillCatalog } from "@/lib/skill-catalog";
import type { SkillDraft, SkillDraftValue } from "@/lib/types";

const DRAFT_DIRECTORY = path.join(process.cwd(), "data", "skill-drafts");
const LIST_LENGTHS: Record<string, number> = { effectIds: 2, effectTypes: 2, effectValues: 2, rpEffects: 6, rpEffectValues: 6, prerequisiteSkillIds: 4 };

export type CreateSkillDraftInput = {
  operation?: "create" | "edit";
  skillClass: number;
  characterClass: number;
  baseTblidx: number;
  newTblidx: number;
  name: string;
  values: Record<string, SkillDraftValue>;
};

function sameValue(left: SkillDraftValue | undefined, right: SkillDraftValue | undefined) { return JSON.stringify(left) === JSON.stringify(right); }

export function validateSkillDraftValues(skillClass: number, values: Record<string, SkillDraftValue>) {
  const fields = getFieldsForSkillClass(skillClass);
  const allowed = new Set(fields.map((item) => item.id));
  const unknown = Object.keys(values).filter((key) => !allowed.has(key as never));
  if (unknown.length) throw new Error(`Campos não permitidos para a categoria: ${unknown.join(", ")}.`);

  for (const metadata of fields) {
    const value = values[metadata.id];
    if (metadata.required && (value === undefined || value === "")) throw new Error(`O campo ${metadata.label} é obrigatório.`);
    if (value === undefined || value === "") continue;
    if (metadata.control === "checkbox" && typeof value !== "boolean") throw new Error(`O campo ${metadata.label} deve ser verdadeiro ou falso.`);
    if (metadata.control === "number-list") {
      if (!Array.isArray(value) || value.some((entry) => !Number.isFinite(entry))) throw new Error(`O campo ${metadata.label} deve ser uma lista numérica.`);
      const expected = LIST_LENGTHS[metadata.id];
      if (expected && value.length !== expected) throw new Error(`${metadata.label} deve possuir exatamente ${expected} valores.`);
      if (["effectTypes", "rpEffects"].includes(metadata.id) && value.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) throw new Error(`${metadata.label} aceita somente valores BYTE entre 0 e 255.`);
      continue;
    }
    if (Array.isArray(value)) throw new Error(`O campo ${metadata.label} não aceita uma lista.`);
    if (["number", "select", "bitflag", "reference"].includes(metadata.control) && typeof value !== "number") throw new Error(`O campo ${metadata.label} deve ser numérico.`);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`${metadata.label} não é um número válido.`);
      if (metadata.step !== 0.01 && !Number.isInteger(value)) throw new Error(`${metadata.label} deve ser inteiro.`);
      if (metadata.min !== undefined && value < metadata.min) throw new Error(`${metadata.label} deve ser no mínimo ${metadata.min}.`);
      if (metadata.max !== undefined && value > metadata.max) throw new Error(`${metadata.label} deve ser no máximo ${metadata.max}.`);
    }
  }

  const textLimits: Record<string, number> = { name: 64, description: 2000, internalName: 40, iconName: 32 };
  for (const [key, limit] of Object.entries(textLimits)) {
    const value = values[key];
    if (typeof value === "string" && value.length > limit) throw new Error(`${key} ultrapassa ${limit} caracteres.`);
  }
}

export async function listSkillDrafts() {
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const files = (await readdir(DRAFT_DIRECTORY)).filter((file) => /^[a-f0-9-]+\.json$/i.test(file));
  const drafts: SkillDraft[] = [];
  for (const file of files) {
    try { drafts.push(JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, file), "utf8")) as SkillDraft); }
    catch (error) { console.error(`Rascunho de skill inválido: ${file}`, error); }
  }
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getSkillDraft(draftId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) throw new Error("Identificador de rascunho inválido.");
  const target = path.join(DRAFT_DIRECTORY, `${draftId}.json`);
  try { return JSON.parse(await readFile(target, "utf8")) as SkillDraft; }
  catch { throw new Error("Rascunho de skill não encontrado."); }
}

export async function markSkillDraftPublished(draftId: string, administrator: string, backupPath: string) {
  const draft = await getSkillDraft(draftId);
  const published: SkillDraft = { ...draft, status: "published", publishedAt: new Date().toISOString(), publishedBy: administrator, publicationBackup: backupPath };
  await writeFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), `${JSON.stringify(published, null, 2)}\n`, "utf8");
  return published;
}

export async function createSkillDraft(input: CreateSkillDraftInput, administrator: string) {
  const operation = input.operation ?? "create";
  const profile = getSkillCreationProfile(input.skillClass);
  if (!profile) throw new Error("Categoria de skill não reconhecida.");
  validateSkillDraftValues(input.skillClass, input.values);
  if (!Number.isInteger(input.newTblidx) || input.newTblidx < 1 || input.newTblidx > 4294967294) throw new Error("Novo TBLIDX inválido.");
  if (input.values.tblidx !== input.newTblidx) throw new Error("O TBLIDX do formulário não corresponde à skill.");
  if (input.values.skillClass !== input.skillClass) throw new Error("A categoria do formulário não corresponde à categoria escolhida.");
  if (!Number.isInteger(input.characterClass) || input.characterClass < 0 || input.characterClass > 20) throw new Error("Classe de personagem inválida.");
  const selectedClassFlag = 1 << input.characterClass;
  if (operation === "create" && (typeof input.values.classFlag !== "number" || (input.values.classFlag & selectedClassFlag) === 0)) throw new Error("A class flag não inclui a classe de personagem selecionada.");
  if (input.values.name !== input.name || !input.name.trim()) throw new Error("Nome da skill inválido.");

  const catalog = await loadSkillCatalog();
  const baseSkill = catalog.skills.find((skill) => skill.tblidx === input.baseTblidx);
  if (!baseSkill || baseSkill.skillClass !== input.skillClass || (operation === "create" && (baseSkill.classFlag & selectedClassFlag) === 0)) throw new Error("A skill-base não pertence à categoria e classe selecionadas.");
  if (operation === "edit" && input.newTblidx !== baseSkill.tblidx) throw new Error("A edição deve preservar o TBLIDX original.");
  if (operation === "create" && catalog.skills.some((skill) => skill.tblidx === input.newTblidx)) throw new Error("O novo TBLIDX já existe no catálogo.");
  const existingDrafts = await listSkillDrafts();
  if (operation === "create" && existingDrafts.some((draft) => (draft.operation ?? "create") === "create" && draft.newTblidx === input.newTblidx)) throw new Error("Já existe um rascunho de criação com esse TBLIDX.");

  const baseValues = getSkillCreationBaseValues(baseSkill);
  const changedFields = getFieldsForSkillClass(input.skillClass).map((field) => field.id).filter((id) => !sameValue(input.values[id], baseValues[id]));
  if (operation === "edit" && changedFields.length === 0) throw new Error("Altere pelo menos um campo antes de salvar a edição.");
  const now = new Date().toISOString();
  const draft: SkillDraft = {
    id: randomUUID(), status: "draft", operation, skillClass: input.skillClass, characterClass: input.characterClass, profile: profile.label,
    baseTblidx: baseSkill.tblidx, baseName: baseSkill.name, newTblidx: input.newTblidx,
    name: input.name.trim(), values: input.values, changedFields, administrator,
    createdAt: now, updatedAt: now,
  };

  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const target = path.join(DRAFT_DIRECTORY, `${draft.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return draft;
}
