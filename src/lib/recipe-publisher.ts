import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadItemCatalog } from "@/lib/item-catalog";
import {
  invalidateRecipeCatalogCache, ITEM_TYPE_RECIPE, loadRecipeCatalog, MAX_RECIPE_MATERIALS, MAX_RECIPE_RESULTS,
  readRecipeValues, RECIPE_HEADER_SIZE, RECIPE_RECORD_SIZE, RECIPE_TYPES, resolveRecipeCatalogPath, writeRecipeRecord,
} from "@/lib/recipe-catalog";
import { constantTimeEqual } from "@/lib/security";
import type { DropPublishChange, RecipeDraft, RecipePublishPreview, RecipeValues } from "@/lib/types";

const DRAFT_DIRECTORY = path.join(process.cwd(), "data", "recipe-drafts");
const VALID_TYPES = new Set(RECIPE_TYPES.map((entry) => entry.value));

let publicationInProgress = false;

const hashBuffer = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function createConfirmationToken(draftId: string, updatedAt: string, rdfHash: string, changes: DropPublishChange[]) {
  return createHash("sha256").update(JSON.stringify({ draftId, updatedAt, rdfHash, changes })).digest("hex");
}

export function validateRecipeValues(values: RecipeValues) {
  if (!VALID_TYPES.has(values.recipeType)) throw new Error("Tipo de receita fora de eRECIPE_TYPE.");
  if (!Number.isInteger(values.needMixLevel) || values.needMixLevel < 0 || values.needMixLevel > 255) throw new Error("O nível de Mix deve ficar entre 0 e 255.");
  if (!Number.isInteger(values.needMixZenny) || values.needMixZenny < 0 || values.needMixZenny > 4294967295) throw new Error("O custo em zeni está fora da faixa.");

  if (!Array.isArray(values.materials) || !values.materials.length) throw new Error("Uma receita precisa de pelo menos um material.");
  if (values.materials.length > MAX_RECIPE_MATERIALS) throw new Error(`O jogo aceita no máximo ${MAX_RECIPE_MATERIALS} materiais.`);
  if (!Array.isArray(values.results) || !values.results.length) throw new Error("Uma receita precisa de pelo menos um resultado.");
  if (values.results.length > MAX_RECIPE_RESULTS) throw new Error(`O jogo aceita no máximo ${MAX_RECIPE_RESULTS} resultados.`);

  const materiais = new Set<number>();
  for (const [index, slot] of values.materials.entries()) {
    if (!Number.isInteger(slot.tblidx) || slot.tblidx < 1 || slot.tblidx > 4294967294) throw new Error(`Material ${index + 1}: item inválido.`);
    // O servidor compara material por POSIÇÃO com o que o cliente enviou. Repetir o mesmo
    // item em duas posições faz a checagem olhar o mesmo slot do inventário duas vezes.
    if (materiais.has(slot.tblidx)) throw new Error(`Material ${index + 1}: o item ${slot.tblidx} já está em outra posição.`);
    materiais.add(slot.tblidx);
    if (!Number.isInteger(slot.quantity) || slot.quantity < 1 || slot.quantity > 255) throw new Error(`Material ${index + 1}: a quantidade deve ficar entre 1 e 255.`);
  }
  for (const [index, slot] of values.results.entries()) {
    if (!Number.isInteger(slot.tblidx) || slot.tblidx < 1 || slot.tblidx > 4294967294) throw new Error(`Resultado ${index + 1}: item inválido.`);
    // Dbo_CheckProbability sorteia RandomRange(1,100) <= rate, então a chance é porcentagem.
    if (!Number.isInteger(slot.rate) || slot.rate < 1 || slot.rate > 100) throw new Error(`Resultado ${index + 1}: a chance deve ficar entre 1 e 100.`);
    if (slot.flag !== 0 && slot.flag !== 1) throw new Error(`Resultado ${index + 1}: o segundo byte só aparece como 0 ou 1 na tabela.`);
  }
}

export async function validateRecipeReferences(values: RecipeValues) {
  const catalog = await loadItemCatalog();
  const known = new Set(catalog.items.map((item) => item.tblidx));
  const issues: string[] = [];
  for (const [index, slot] of values.materials.entries()) {
    if (!known.has(slot.tblidx)) issues.push(`Material ${index + 1}: o item ${slot.tblidx} não existe em Table_Item_Data.rdf.`);
  }
  for (const [index, slot] of values.results.entries()) {
    if (!known.has(slot.tblidx)) issues.push(`Resultado ${index + 1}: o item ${slot.tblidx} não existe em Table_Item_Data.rdf.`);
  }
  return issues;
}

function diffRecipeValues(before: RecipeValues | null, after: RecipeValues) {
  if (!before) return ["novo"];
  const changed: string[] = [];
  for (const field of ["valid", "recipeType", "needMixLevel", "needMixZenny"] as const) {
    if (before[field] !== after[field]) changed.push(field);
  }
  const maxResults = Math.max(before.results.length, after.results.length);
  for (let index = 0; index < maxResults; index += 1) if (!sameValue(before.results[index], after.results[index])) changed.push(`resultado.${index}`);
  const maxMaterials = Math.max(before.materials.length, after.materials.length);
  for (let index = 0; index < maxMaterials; index += 1) if (!sameValue(before.materials[index], after.materials[index])) changed.push(`material.${index}`);
  return changed;
}

async function describe(tblidx: number | undefined) {
  if (tblidx === undefined) return "vazio";
  const catalog = await loadItemCatalog();
  const item = catalog.items.find((entry) => entry.tblidx === tblidx);
  return `${item?.name ?? "item desconhecido"} (#${tblidx})`;
}

/* ---------------------------------- rascunhos ---------------------------------- */

export async function listRecipeDrafts() {
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const files = (await readdir(DRAFT_DIRECTORY)).filter((file) => /^[a-f0-9-]+\.json$/i.test(file));
  const drafts: RecipeDraft[] = [];
  for (const file of files) {
    try { drafts.push(JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, file), "utf8")) as RecipeDraft); }
    catch (error) { console.error(`Rascunho de receita inválido: ${file}`, error); }
  }
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getRecipeDraft(draftId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) throw new Error("Identificador de rascunho inválido.");
  try { return JSON.parse(await readFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), "utf8")) as RecipeDraft; }
  catch { throw new Error("Rascunho de receita não encontrado."); }
}

export async function createRecipeDraft(tblidx: number, values: RecipeValues, administrator: string) {
  validateRecipeValues(values);

  const [recipeCatalog, itemCatalog] = await Promise.all([loadRecipeCatalog(), loadItemCatalog()]);
  const item = itemCatalog.items.find((entry) => entry.tblidx === tblidx);
  if (!item) throw new Error(`O item ${tblidx} não existe em Table_Item_Data.rdf.`);
  if (item.itemType !== ITEM_TYPE_RECIPE) throw new Error(`O item ${tblidx} não é do tipo Receita; ninguém conseguiria aprender esta receita.`);

  const referenceIssues = await validateRecipeReferences(values);
  if (referenceIssues.length) throw new Error(referenceIssues.join(" "));

  const offset = recipeCatalog.offsetByTblidx.get(tblidx);
  const operation = offset === undefined ? "create" : "edit";
  const baseValues = offset === undefined ? null : readRecipeValues(recipeCatalog.buffer, offset);
  const changedFields = diffRecipeValues(baseValues, values);
  if (operation === "edit" && !changedFields.length) throw new Error("Altere alguma coisa antes de salvar o rascunho.");

  const open = (await listRecipeDrafts()).filter((draft) => draft.status === "draft" && draft.tblidx === tblidx);
  if (open.length) throw new Error("Já existe um rascunho aberto para esta receita. Publique ou descarte antes de criar outro.");

  const now = new Date().toISOString();
  const draft: RecipeDraft = {
    id: randomUUID(), status: "draft", operation, tblidx,
    name: item.name, nameTextId: item.nameTextId,
    values, baseValues, changedFields, administrator, createdAt: now, updatedAt: now,
  };
  await mkdir(DRAFT_DIRECTORY, { recursive: true });
  const target = path.join(DRAFT_DIRECTORY, `${draft.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return draft;
}

export async function deleteRecipeDraft(draftId: string) {
  const draft = await getRecipeDraft(draftId);
  if (draft.status === "published") throw new Error("Um rascunho já publicado não pode ser descartado.");
  await unlink(path.join(DRAFT_DIRECTORY, `${draftId}.json`));
  return draft;
}

async function markPublished(draftId: string, administrator: string, backupPath: string) {
  const draft = await getRecipeDraft(draftId);
  const published: RecipeDraft = { ...draft, status: "published", publishedAt: new Date().toISOString(), publishedBy: administrator, publicationBackup: backupPath };
  await writeFile(path.join(DRAFT_DIRECTORY, `${draftId}.json`), `${JSON.stringify(published, null, 2)}\n`, "utf8");
  return published;
}

/* ---------------------------------- publicação ---------------------------------- */

function findRecordOffset(buffer: Buffer, tblidx: number) {
  if (buffer.length <= RECIPE_HEADER_SIZE || (buffer.length - RECIPE_HEADER_SIZE) % RECIPE_RECORD_SIZE !== 0) {
    throw new Error("O formato atual do Table_Item_Recipe_Data.rdf é incompatível.");
  }
  for (let offset = RECIPE_HEADER_SIZE; offset < buffer.length; offset += RECIPE_RECORD_SIZE) {
    if (buffer.readUInt32LE(offset) === tblidx) return offset;
  }
  return -1;
}

async function publicationContext(draftId: string) {
  const draft = await getRecipeDraft(draftId);
  const rdfPath = resolveRecipeCatalogPath();
  const rdfBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
  const rdfHash = hashBuffer(rdfBuffer);

  const blockingIssues: string[] = [];
  if (draft.status !== "draft") blockingIssues.push("Este rascunho já foi publicado.");
  try { validateRecipeValues(draft.values); }
  catch (error) { blockingIssues.push(error instanceof Error ? error.message : "Os valores do rascunho são inválidos."); }
  blockingIssues.push(...(await validateRecipeReferences(draft.values)));

  const offset = findRecordOffset(rdfBuffer, draft.tblidx);
  // A operação sai do arquivo de AGORA, não do que o rascunho anotou: alguém pode ter criado
  // a receita por fora desde então, e aí criar de novo faria um registro duplicado que o
  // servidor descarta em silêncio (AddTable recusa tblidx repetido).
  const operation: "create" | "edit" = offset === -1 ? "create" : "edit";
  if (operation !== draft.operation) {
    blockingIssues.push(offset === -1
      ? "O registro sumiu do RDF desde que o rascunho foi salvo; ele viraria uma criação."
      : "A receita passou a existir no RDF desde que o rascunho foi salvo; publicar criaria um registro duplicado.");
  }

  const currentValues = offset === -1 ? null : readRecipeValues(rdfBuffer, offset);
  const changes: DropPublishChange[] = [];
  for (const id of diffRecipeValues(currentValues, draft.values)) {
    if (id === "novo") {
      changes.push({ id, label: "Registro novo", before: "não existe no RDF", after: `receita #${draft.tblidx} (${draft.name})` });
      continue;
    }
    if (id.startsWith("resultado.") || id.startsWith("material.")) {
      const index = Number(id.split(".")[1]);
      const isResult = id.startsWith("resultado.");
      const antes = isResult ? currentValues?.results[index] : currentValues?.materials[index];
      const depois = isResult ? draft.values.results[index] : draft.values.materials[index];
      const texto = async (slot: typeof antes | typeof depois) => {
        if (!slot) return "vazio";
        return "rate" in slot
          ? `${await describe(slot.tblidx)} · ${slot.rate}%`
          : `${await describe(slot.tblidx)} · ${slot.quantity}x`;
      };
      changes.push({ id, label: `${isResult ? "Resultado" : "Material"} ${index + 1}`, before: await texto(antes), after: await texto(depois) });
      continue;
    }
    const rotulos: Record<string, string> = { valid: "Receita ativa", recipeType: "Tipo", needMixLevel: "Nível de Mix", needMixZenny: "Custo em zeni" };
    changes.push({
      id, label: rotulos[id] ?? id,
      before: String(currentValues?.[id as keyof RecipeValues] ?? "—"),
      after: String(draft.values[id as keyof RecipeValues]),
    });
  }
  if (!changes.length) blockingIssues.push("O RDF atual já possui todos os valores deste rascunho.");

  const warnings = [
    operation === "create"
      ? "A publicação acrescenta um registro ao fim de Table_Item_Recipe_Data.rdf; o arquivo cresce 84 bytes."
      : "A publicação regrava o registro existente em Table_Item_Recipe_Data.rdf.",
    "O GameServer precisa ser reiniciado para recarregar a tabela; não existe comando de recarga.",
    "Quem já aprendeu esta receita continua com ela; a mudança vale na próxima vez que fabricar.",
  ];
  if (draft.values.results.length > 1) {
    warnings.push("Com mais de um resultado, o servidor só sorteia de verdade quando dois ou mais passam na chance. Se nenhum ou só um passar, ele entrega o resultado 1.");
  }

  const confirmationToken = blockingIssues.length ? null : createConfirmationToken(draftId, draft.updatedAt, rdfHash, changes);
  return { draft, rdfPath, operation, changes, warnings, blockingIssues, confirmationToken };
}

export async function getRecipePublishPreview(draftId: string): Promise<RecipePublishPreview> {
  const context = await publicationContext(draftId);
  return {
    draftId, operation: context.operation, tblidx: context.draft.tblidx, name: context.draft.name,
    rdfPath: context.rdfPath, changes: context.changes, warnings: context.warnings,
    blockingIssues: context.blockingIssues, confirmationToken: context.confirmationToken,
  };
}

export async function publishRecipeDraft(draftId: string, confirmationToken: string, administrator: string) {
  if (publicationInProgress) throw new Error("Outra publicação de receita está em andamento.");
  publicationInProgress = true;
  try {
    const context = await publicationContext(draftId);
    if (context.blockingIssues.length || !context.confirmationToken) throw new Error(context.blockingIssues.join(" ") || "O rascunho não pode ser publicado.");
    if (!constantTimeEqual(confirmationToken, context.confirmationToken)) throw new Error("A confirmação expirou porque o rascunho ou o RDF mudou. Valide novamente.");

    const { draft, rdfPath } = context;
    const latestBuffer = await readFile(/* turbopackIgnore: true */ rdfPath);
    const latestToken = createConfirmationToken(draftId, draft.updatedAt, hashBuffer(latestBuffer), context.changes);
    if (!constantTimeEqual(confirmationToken, latestToken)) throw new Error("O RDF mudou após a validação. Valide novamente antes de publicar.");

    const offset = findRecordOffset(latestBuffer, draft.tblidx);
    let nextBuffer: Buffer;
    if (offset === -1) {
      // O carregador do servidor lê registros em laço até faltar byte (ItemRecipeTable.cpp),
      // então um registro inteiro no fim do arquivo entra normalmente.
      nextBuffer = Buffer.concat([latestBuffer, Buffer.alloc(RECIPE_RECORD_SIZE)]);
      writeRecipeRecord(nextBuffer, latestBuffer.length, draft.tblidx, draft.nameTextId, draft.values);
      if (nextBuffer.length !== latestBuffer.length + RECIPE_RECORD_SIZE) throw new Error("O acréscimo não deu o tamanho esperado; publicação cancelada.");
    } else {
      nextBuffer = Buffer.from(latestBuffer);
      writeRecipeRecord(nextBuffer, offset, draft.tblidx, draft.nameTextId, draft.values);
      if (nextBuffer.length !== latestBuffer.length) throw new Error("A gravação alterou o tamanho do arquivo; publicação cancelada.");
    }
    if ((nextBuffer.length - RECIPE_HEADER_SIZE) % RECIPE_RECORD_SIZE !== 0) throw new Error("O arquivo resultante não fecha em registros inteiros; publicação cancelada.");

    const backupDirectory = path.join(process.cwd(), "data", "recipe-rdf-backups");
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `Table_Item_Recipe_Data.${stamp}.before-${draftId}.rdf`);
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
      invalidateRecipeCatalogCache();
      const catalog = await loadRecipeCatalog();
      const written = catalog.offsetByTblidx.get(draft.tblidx);
      if (written === undefined) throw new Error("A receita não foi encontrada no RDF depois da gravação.");
      const failed = diffRecipeValues(readRecipeValues(catalog.buffer, written), draft.values);
      if (failed.length) throw new Error(`A verificação após a gravação falhou em: ${failed.join(", ")}.`);
    } catch (error) {
      await unlink(rdfPath).catch(() => undefined);
      await rename(rollbackPath, rdfPath);
      invalidateRecipeCatalogCache();
      throw error;
    }

    await unlink(rollbackPath);
    const relativeBackup = path.relative(process.cwd(), backupPath);
    const publishedDraft = await markPublished(draftId, administrator, relativeBackup);
    return {
      draft: publishedDraft, backupPath: relativeBackup, rdfPath, operation: context.operation,
      changes: context.changes, beforeHash: hashBuffer(latestBuffer), afterHash: hashBuffer(nextBuffer),
      warnings: context.warnings,
    };
  } finally {
    publicationInProgress = false;
  }
}
