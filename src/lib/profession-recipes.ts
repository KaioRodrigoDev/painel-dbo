import "server-only";

import type { RowDataPacket } from "mysql2/promise";

import { getCharacterPool } from "@/lib/db";
import { loadItemCatalog } from "@/lib/item-catalog";
import {
  catalogInfo, type CatalogSnapshot, type CompiledRecipe, decodeFrozenRecipe, identityAccepts, readProfessionCatalog, saveCatalogDraft,
} from "@/lib/profession-catalog";
import {
  allowedBatches, FIXED_IDENTITIES, professionRecipeIssues, type ProfessionIdentity, type ProfessionRecipeShape,
} from "@/lib/profession-rules";
import type {
  ItemCatalogEntry, ProfessionCatalogDraft, ProfessionRecipe, ProfessionRecipeIdentity, ProfessionRecipeItem, ProfessionRecipeOverview, ProfessionRecipeValues,
} from "@/lib/types";

/**
 * Receitas das oficinas de profissão no banco de personagens (mdbo_char.profession_forge_recipe,
 * DboServer/Database/migrations/20261022_profession_forge_runtime.sql).
 *
 * O QueryServer lê a tabela uma vez ao iniciar e quando alguém digita forgerecipesreload no console
 * dele (tools/professions/FORGE-CACHE.md): gravar aqui não muda o jogo até a recarga. Ordens já
 * iniciadas guardam a receita com que começaram.
 *
 * Profissão, produto e materiais vêm do catálogo compilado (lib/profession-catalog.ts): uma troca
 * fica pendente até o build e entra no banco por applyProfessionCatalog.
 */

export class ProfessionRecipeError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

const COLUMNS = "id,base,specialization,required_level,duration_seconds,experience,output_item,output_count,output_durability,input_count,input1,amount1,input2,amount2,input3,amount3,input4,amount4,enabled";

type RecipeRow = RowDataPacket & {
  id: number; base: number; specialization: number; required_level: number; duration_seconds: number; experience: number;
  output_item: number; output_count: number; output_durability: number; input_count: number;
  input1: number; amount1: number; input2: number; amount2: number; input3: number; amount3: number; input4: number; amount4: number;
  enabled: number;
};

function shapeOf(row: RecipeRow): ProfessionRecipeShape {
  const count = Math.max(0, Math.min(4, Number(row.input_count)));
  const inputs = [row.input1, row.input2, row.input3, row.input4].slice(0, count).map(Number);
  const amounts = [row.amount1, row.amount2, row.amount3, row.amount4].slice(0, count).map(Number);
  return {
    id: Number(row.id), base: Number(row.base), specialization: Number(row.specialization),
    requiredLevel: Number(row.required_level), durationSeconds: Number(row.duration_seconds), experience: Number(row.experience),
    outputItem: Number(row.output_item), outputCount: Number(row.output_count), outputDurability: Number(row.output_durability),
    inputItems: inputs, amounts,
  };
}

function shapeOfCompiled(recipe: CompiledRecipe): ProfessionRecipeShape {
  return {
    id: recipe.id, base: recipe.base, specialization: recipe.specialization,
    requiredLevel: recipe.level, durationSeconds: recipe.seconds, experience: recipe.experience,
    outputItem: recipe.output, outputCount: recipe.outputCount, outputDurability: recipe.durability,
    inputItems: recipe.inputs.map((input) => input.item), amounts: recipe.inputs.map((input) => input.count),
  };
}

function valuesOf(row: RecipeRow): ProfessionRecipeValues {
  const shape = shapeOf(row);
  return {
    requiredLevel: shape.requiredLevel, durationSeconds: shape.durationSeconds, experience: shape.experience,
    outputCount: shape.outputCount, amounts: shape.amounts, enabled: Number(row.enabled) !== 0,
  };
}

/** A linha do banco passa no DecodeRecipe do QueryServer com este catálogo (especialização exata)? */
const rowMatches = (compiled: CompiledRecipe, shape: ProfessionRecipeShape) => identityAccepts(compiled, {
  base: shape.base, specialization: shape.specialization, output: shape.outputItem, durability: shape.outputDurability,
  outputCount: shape.outputCount, inputs: shape.inputItems,
}, false);

const identityOfCompiled = (recipe: CompiledRecipe): ProfessionIdentity => ({
  base: recipe.base, specialization: recipe.specialization, output: recipe.output, durability: recipe.durability,
  outputCountFixed: recipe.durability > 0, inputs: recipe.inputs.map((input) => input.item),
});

async function tableExists(name: string) {
  const [rows] = await getCharacterPool().query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [name]);
  return Number(rows[0]?.total) === 1;
}

async function itemLookup() {
  const items = await loadItemCatalog().then((catalog) => new Map(catalog.items.map((item) => [item.tblidx, item]))).catch(() => null);
  const describe = (tblidx: number): ProfessionRecipeItem => {
    const item: ItemCatalogEntry | undefined = items?.get(tblidx);
    return { tblidx, name: item?.name || `Item #${tblidx}`, iconName: item?.iconName ?? "", maxStack: item ? Number(item.maxStack) : null };
  };
  return { loaded: items !== null, describe };
}

async function readCatalog(): Promise<CatalogSnapshot | { reason: string }> {
  return readProfessionCatalog().catch((error: unknown) => ({ reason: `Não foi possível ler o catálogo: ${error instanceof Error ? error.message : String(error)}` }));
}

/** Catálogo compilado por ID; undefined quando não foi encontrado (aí a identidade não é conferida). */
const compiledById = (snapshot: CatalogSnapshot | { reason: string }) =>
  "root" in snapshot ? new Map(snapshot.compiled.map((recipe) => [recipe.id, recipe])) : undefined;

function identityFor(id: number, compiled: Map<number, CompiledRecipe> | undefined): ProfessionIdentity | null | undefined {
  const fixed = FIXED_IDENTITIES.get(id);
  if (fixed) return fixed;
  if (!compiled) return undefined;
  const recipe = compiled.get(id);
  return recipe ? identityOfCompiled(recipe) : null;
}

function describeIdentity(recipe: CompiledRecipe, describe: (tblidx: number) => ProfessionRecipeItem): ProfessionRecipeIdentity {
  return {
    specialization: recipe.specialization, output: describe(recipe.output), outputCount: recipe.outputCount, outputDurability: recipe.durability,
    inputs: recipe.inputs.map((input) => ({ ...describe(input.item), amount: input.count })),
  };
}

function toRecipe(shape: ProfessionRecipeShape, enabled: boolean, inDatabase: boolean, describe: (tblidx: number) => ProfessionRecipeItem,
  compiled: Map<number, CompiledRecipe> | undefined, catalogIds: Set<number>): ProfessionRecipe {
  const output = describe(shape.outputItem);
  const inputs = shape.inputItems.map((tblidx, index) => ({ ...describe(tblidx), amount: shape.amounts[index]! }));
  const target = compiled?.get(shape.id);
  const pending = target && !FIXED_IDENTITIES.has(shape.id) && (!inDatabase || !rowMatches(target, shape)) ? describeIdentity(target, describe) : null;
  const identity = pending ? undefined : identityFor(shape.id, compiled);
  return {
    id: shape.id, base: shape.base, specialization: shape.specialization,
    requiredLevel: shape.requiredLevel, durationSeconds: shape.durationSeconds, experience: shape.experience,
    output, outputCount: shape.outputCount, outputDurability: shape.outputDurability, inputs, enabled,
    outputCountFixed: identity?.outputCountFixed ?? shape.outputDurability > 0,
    batches: allowedBatches(shape, output.maxStack, inputs.map((input) => input.maxStack)),
    issues: professionRecipeIssues(shape, identity),
    inDatabase, identityEditable: catalogIds.has(shape.id), pending,
  };
}

export async function getProfessionRecipes(): Promise<ProfessionRecipeOverview> {
  const snapshot = await readCatalog();
  const info = catalogInfo(snapshot);
  if (!(await tableExists("profession_forge_recipe")))
    return { ready: false, recipes: [], itemsLoaded: false, catalog: { ...info, pendingIds: [], applyReady: false } };
  const [[rows], items] = await Promise.all([
    getCharacterPool().query<RecipeRow[]>(`SELECT ${COLUMNS} FROM profession_forge_recipe ORDER BY id`),
    itemLookup(),
  ]);
  const compiled = compiledById(snapshot);
  const catalogIds = new Set("root" in snapshot ? snapshot.file.recipes.map((recipe) => recipe.id) : []);
  const stored = new Set(rows.map((row) => Number(row.id)));
  const recipes = [
    ...rows.map((row) => toRecipe(shapeOf(row), Number(row.enabled) !== 0, true, items.describe, compiled, catalogIds)),
    // Receita nova do catálogo: aparece já, entra no banco (ativa) ao aplicar depois do build.
    ...[...(compiled?.values() ?? [])].filter((recipe) => !stored.has(recipe.id))
      .map((recipe) => toRecipe(shapeOfCompiled(recipe), false, false, items.describe, compiled, catalogIds)),
  ].sort((left, right) => left.id - right.id);
  const pendingIds = recipes.filter((recipe) => recipe.pending).map((recipe) => recipe.id);
  return {
    ready: true, itemsLoaded: items.loaded, recipes,
    catalog: { ...info, pendingIds, applyReady: info.available && !info.buildNeeded && pendingIds.length > 0 },
  };
}

const sameValues = (left: ProfessionRecipeValues, right: ProfessionRecipeValues) =>
  left.requiredLevel === right.requiredLevel && left.durationSeconds === right.durationSeconds && left.experience === right.experience &&
  left.outputCount === right.outputCount && left.enabled === right.enabled &&
  left.amounts.length === right.amounts.length && left.amounts.every((amount, index) => amount === right.amounts[index]);

/**
 * Grava os campos editáveis de uma receita. `expected` são os valores que o editor abriu: se a
 * linha mudou desde então (outra aba, outro administrador, SQL), nada é gravado. Identidade
 * (profissão, produto, durabilidade, materiais) não muda por aqui: vai pelo catálogo.
 */
export async function updateProfessionRecipe(id: number, values: ProfessionRecipeValues, expected: ProfessionRecipeValues) {
  if (!(await tableExists("profession_forge_recipe"))) throw new ProfessionRecipeError("A tabela profession_forge_recipe não existe neste banco.");
  const compiled = compiledById(await readCatalog());
  const connection = await getCharacterPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RecipeRow[]>(`SELECT ${COLUMNS} FROM profession_forge_recipe WHERE id=? FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row) throw new ProfessionRecipeError(`A receita #${id} ainda não está no banco: ela entra ao aplicar o catálogo depois do build.`, 404);
    if (!sameValues(valuesOf(row), expected))
      throw new ProfessionRecipeError("A receita mudou no banco depois que você abriu o editor. Atualize a lista e edite de novo.");

    const shape = shapeOf(row);
    if (values.amounts.length !== shape.inputItems.length)
      throw new ProfessionRecipeError("A quantidade de materiais não confere com a receita.", 400);
    const next: ProfessionRecipeShape = {
      ...shape, requiredLevel: values.requiredLevel, durationSeconds: values.durationSeconds, experience: values.experience,
      outputCount: values.outputCount, amounts: values.amounts,
    };
    const target = compiled?.get(id);
    const pending = target && !FIXED_IDENTITIES.has(id) && !rowMatches(target, shape);
    const issues = professionRecipeIssues(next, pending ? undefined : identityFor(id, compiled));
    // Desativada o servidor nem lê; ativa, uma receita recusada derruba a recarga inteira.
    if (values.enabled && issues.length) throw new ProfessionRecipeError(`O servidor recusaria esta receita: ${issues.join(" ")}`, 400);
    const items = await itemLookup();
    if (values.enabled && items.loaded) {
      const output = items.describe(shape.outputItem);
      const batches = allowedBatches(next, output.maxStack, shape.inputItems.map((tblidx) => items.describe(tblidx).maxStack));
      if (!batches.includes(1)) throw new ProfessionRecipeError(
        `Com esses valores a bancada não deixa produzir nem 1x: o produto não cabe numa pilha (máximo ${output.maxStack ?? "?"}) ou os materiais passam de 8 pilhas.`, 400);
    }

    const amounts = [0, 1, 2, 3].map((index) => index < values.amounts.length ? values.amounts[index]! : Number(row[`amount${index + 1}` as keyof RecipeRow]));
    await connection.query(
      "UPDATE profession_forge_recipe SET required_level=?,duration_seconds=?,experience=?,output_count=?,amount1=?,amount2=?,amount3=?,amount4=?,enabled=? WHERE id=?",
      [values.requiredLevel, values.durationSeconds, values.experience, values.outputCount, ...amounts, values.enabled ? 1 : 0, id]);
    await connection.commit();
    return { previous: valuesOf(row) };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

type Expected = Pick<CompiledRecipe, "base" | "specialization" | "output" | "durability" | "inputs">;
type JobRow = RowDataPacket & { char_id: number; char_name: string | null; definition_hex: string | null };

/**
 * Ordens em andamento (character_forge_job) que o servidor deixaria de ler com a receita nova: a
 * ordem guarda a receita com que começou e o LoadJob confere essa cópia contra o catálogo compilado.
 */
async function ordersBrokenBy(expected: Map<number, Expected>) {
  if (!expected.size || !(await tableExists("character_forge_job"))) return [];
  const [rows] = await getCharacterPool().query<JobRow[]>(
    "SELECT j.char_id, c.char_name, j.definition_hex FROM character_forge_job j LEFT JOIN characters c ON c.id=j.char_id WHERE j.state=1");
  return rows.flatMap((row) => {
    const frozen = row.definition_hex ? decodeFrozenRecipe(String(row.definition_hex)) : null;
    const target = frozen && expected.get(frozen.id);
    return target && !identityAccepts(target, frozen, true) ? [`${row.char_name ?? `personagem #${row.char_id}`} (#${frozen.id})`] : [];
  });
}

/**
 * Troca profissão, produto e materiais de uma receita (ou cria uma) no miner-catalog.json. O banco
 * e o jogo só mudam depois do build, em applyProfessionCatalog.
 */
export async function saveProfessionCatalogRecipe(draft: ProfessionCatalogDraft, expectedVersion: string) {
  const items = await itemLookup();
  if (!items.loaded) throw new ProfessionRecipeError("Sem a Table_Item_Data não dá para conferir os itens da receita.", 503);
  const taken = (await tableExists("profession_forge_recipe"))
    ? new Set((await getCharacterPool().query<RowDataPacket[]>("SELECT id FROM profession_forge_recipe"))[0].map((row) => Number(row.id)))
    : new Set<number>();
  return saveCatalogDraft(draft, expectedVersion, items.describe, taken, async (id, expected) => {
    const broken = await ordersBrokenBy(new Map([[id, expected]]));
    if (broken.length) throw new ProfessionRecipeError(
      `Há ordem em andamento desta receita, que o build novo não conseguiria ler: ${broken.join(", ")}. Espere retirar ou cancelar e tente de novo.`);
  });
}

/**
 * Depois do build: grava no banco o que o catálogo compilado diz e o banco ainda não tem. Receita
 * nova entra ativa com nível, tempo e XP do catálogo; numa existente mudam só profissão, produto,
 * durabilidade e materiais (nível, tempo, XP e ativa ficam como estavam).
 */
export async function applyProfessionCatalog(expectedVersion: string) {
  const snapshot = await readCatalog();
  if (!("root" in snapshot)) throw new ProfessionRecipeError(snapshot.reason, 404);
  if (snapshot.version !== expectedVersion) throw new ProfessionRecipeError("O catálogo mudou desde que a lista foi carregada. Atualize e confira de novo.");
  const stale = snapshot.build.filter((part) => part.stale);
  if (stale.length) throw new ProfessionRecipeError(
    `Ainda falta build: ${stale.map((part) => `${part.label} (${part.command})`).join(" e ")}. O banco não muda antes, senão o servidor atual recusa as receitas.`);
  if (!(await tableExists("profession_forge_recipe"))) throw new ProfessionRecipeError("A tabela profession_forge_recipe não existe neste banco.");

  const connection = await getCharacterPool().getConnection();
  const inserted: number[] = [];
  const updated: number[] = [];
  const changed = new Map<number, Expected>();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RecipeRow[]>(`SELECT ${COLUMNS} FROM profession_forge_recipe FOR UPDATE`);
    const stored = new Map(rows.map((row) => [Number(row.id), row]));
    for (const recipe of snapshot.compiled) {
      const row = stored.get(recipe.id);
      if (row && rowMatches(recipe, shapeOf(row))) continue;
      const slots = [0, 1, 2, 3].flatMap((index) => [recipe.inputs[index]?.item ?? 0, recipe.inputs[index]?.count ?? 0]);
      if (!row) {
        await connection.query(`INSERT INTO profession_forge_recipe (${COLUMNS}) VALUES (${COLUMNS.split(",").map(() => "?").join(",")})`, [
          recipe.id, recipe.base, recipe.specialization, recipe.level, recipe.seconds, recipe.experience, recipe.output, recipe.outputCount,
          recipe.durability, recipe.inputs.length, ...slots, 1]);
        inserted.push(recipe.id);
      } else {
        await connection.query(
          "UPDATE profession_forge_recipe SET base=?,specialization=?,output_item=?,output_count=?,output_durability=?,input_count=?," +
          "input1=?,amount1=?,input2=?,amount2=?,input3=?,amount3=?,input4=?,amount4=? WHERE id=?",
          [recipe.base, recipe.specialization, recipe.output, recipe.outputCount, recipe.durability, recipe.inputs.length, ...slots, recipe.id]);
        updated.push(recipe.id);
      }
      changed.set(recipe.id, recipe);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  return { inserted, updated, brokenOrders: await ordersBrokenBy(changed).catch(() => []) };
}
