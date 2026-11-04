import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import { loadItemCatalog } from "@/lib/item-catalog";
import type { RecipeEntry, RecipeValues } from "@/lib/types";

/**
 * Table_Item_Recipe_Data.rdf — as receitas do HoiPoi Mix.
 *
 * Três coisas que o código do servidor deixa claras e que mandam no editor:
 *
 * 1. A receita é procurada pelo **tblidx do item** que a ensina
 *    (`item.cpp`, `case ACTIVE_RECIPE_UPDATE`: `FindData(GetTblidx())`). Receita e item-receita
 *    são o MESMO número. Confirmado: 663 das 664 receitas têm um item de tipo 42 com o mesmo
 *    tblidx e efeito de uso 520 (ACTIVE_RECIPE_UPDATE). A sobra, 10150002, não tem item --
 *    ninguém consegue aprendê-la.
 *
 * 2. `dwName` é o `nameTextId` do próprio item, igual nos 663 casos. Criar uma receita não
 *    exige escrever nada na tabela de textos.
 *
 * 3. Os limites vêm de NtlItem.h: 5 materiais e 3 resultados.
 *
 * Layout de `sITEM_RECIPE_TBLDAT` com `#pragma pack(4)`: 84 bytes, que dividem o arquivo em
 * 664 registros exatos.
 */
export const RECIPE_HEADER_SIZE = 1;
export const RECIPE_RECORD_SIZE = 84;
export const MAX_RECIPE_MATERIALS = 5;
export const MAX_RECIPE_RESULTS = 3;
export const INVALID_TBLIDX = 0xffffffff;

/** eITEM_TYPE::ITEM_TYPE_RECIPE e o efeito de uso que registra a receita no jogador. */
export const ITEM_TYPE_RECIPE = 42;
export const RECIPE_UPDATE_EFFECT = 520;

export const RECIPE_OFFSETS = {
  valid: 4, name: 8, recipeType: 12, needMixLevel: 13, needMixZenny: 16,
  results: 20,   // sRECIPE_CREATE_DATA[3], 8 bytes cada: tblidx, rate, byUnknown
  materials: 44, // sRECIPE_MATERIAL_DATA[5], 8 bytes cada: tblidx, count
} as const;

/** eRECIPE_TYPE, em NtlItem.h. */
export const RECIPE_TYPES = [
  { value: 0, label: "Normal" }, { value: 1, label: "Arma principal" }, { value: 2, label: "Armadura de pano" },
  { value: 3, label: "Acessório" }, { value: 4, label: "Armadura técnica" }, { value: 5, label: "Arma secundária" },
  { value: 6, label: "Evento" }, { value: 7, label: "Especial" },
];

type CatalogCache = {
  path: string; modifiedAt: number; size: number;
  buffer: Buffer;
  offsetByTblidx: Map<number, number>;
  tblidxs: number[];
};

let catalogCache: CatalogCache | null = null;

export function resolveRecipeCatalogPath() {
  return resolveServerTable("Table_Item_Recipe_Data.rdf", "RECIPE_TABLE_PATH");
}

/** Descarta o cache depois de publicar; ver o mesmo motivo em drop-catalog.ts. */
export function invalidateRecipeCatalogCache() {
  catalogCache = null;
}

export async function loadRecipeCatalog() {
  const catalogPath = resolveRecipeCatalogPath();
  const fileStat = await stat(/* turbopackIgnore: true */ catalogPath);
  if (catalogCache?.path === catalogPath && catalogCache.modifiedAt === fileStat.mtimeMs && catalogCache.size === fileStat.size) {
    return catalogCache;
  }

  const buffer = await readFile(/* turbopackIgnore: true */ catalogPath);
  if (buffer.length <= RECIPE_HEADER_SIZE || (buffer.length - RECIPE_HEADER_SIZE) % RECIPE_RECORD_SIZE !== 0) {
    throw new Error(`Formato de Table_Item_Recipe_Data.rdf incompatível: ${buffer.length} bytes.`);
  }

  const offsetByTblidx = new Map<number, number>();
  const tblidxs: number[] = [];
  for (let offset = RECIPE_HEADER_SIZE; offset < buffer.length; offset += RECIPE_RECORD_SIZE) {
    const tblidx = buffer.readUInt32LE(offset);
    offsetByTblidx.set(tblidx, offset);
    tblidxs.push(tblidx);
  }

  catalogCache = { path: catalogPath, modifiedAt: fileStat.mtimeMs, size: fileStat.size, buffer, offsetByTblidx, tblidxs };
  return catalogCache;
}

/** Os campos editáveis de um registro, com as posições vazias já removidas. */
export function readRecipeValues(buffer: Buffer, offset: number): RecipeValues {
  const results = [];
  for (let index = 0; index < MAX_RECIPE_RESULTS; index += 1) {
    const base = offset + RECIPE_OFFSETS.results + index * 8;
    const tblidx = buffer.readUInt32LE(base);
    if (tblidx === INVALID_TBLIDX || tblidx === 0) continue;
    results.push({ tblidx, rate: buffer.readUInt8(base + 4), flag: buffer.readUInt8(base + 5) });
  }
  const materials = [];
  for (let index = 0; index < MAX_RECIPE_MATERIALS; index += 1) {
    const base = offset + RECIPE_OFFSETS.materials + index * 8;
    const tblidx = buffer.readUInt32LE(base);
    if (tblidx === INVALID_TBLIDX || tblidx === 0) continue;
    materials.push({ tblidx, quantity: buffer.readUInt8(base + 4) });
  }
  return {
    valid: buffer.readUInt8(offset + RECIPE_OFFSETS.valid) !== 0,
    recipeType: buffer.readUInt8(offset + RECIPE_OFFSETS.recipeType),
    needMixLevel: buffer.readUInt8(offset + RECIPE_OFFSETS.needMixLevel),
    needMixZenny: buffer.readUInt32LE(offset + RECIPE_OFFSETS.needMixZenny),
    results,
    materials,
  };
}

/**
 * Grava um registro inteiro, compactando as posições.
 *
 * As vagas sobrando recebem `INVALID_TBLIDX`, que é o que o servidor testa para saber onde a
 * lista termina (`asMaterial[b].materialTblidx != INVALID_TBLIDX`). Zero ali faria ele contar
 * um material a mais e recusar toda tentativa de fabricar, porque a contagem enviada pelo
 * cliente não bateria.
 */
export function writeRecipeRecord(buffer: Buffer, offset: number, tblidx: number, nameTextId: number, values: RecipeValues) {
  buffer.writeUInt32LE(tblidx, offset);
  buffer.writeUInt8(values.valid ? 1 : 0, offset + RECIPE_OFFSETS.valid);
  buffer.writeUInt32LE(nameTextId, offset + RECIPE_OFFSETS.name);
  buffer.writeUInt8(values.recipeType, offset + RECIPE_OFFSETS.recipeType);
  buffer.writeUInt8(values.needMixLevel, offset + RECIPE_OFFSETS.needMixLevel);
  buffer.writeUInt32LE(values.needMixZenny, offset + RECIPE_OFFSETS.needMixZenny);

  for (let index = 0; index < MAX_RECIPE_RESULTS; index += 1) {
    const base = offset + RECIPE_OFFSETS.results + index * 8;
    const slot = values.results[index];
    buffer.writeUInt32LE(slot?.tblidx ?? INVALID_TBLIDX, base);
    buffer.writeUInt8(slot?.rate ?? 0, base + 4);
    buffer.writeUInt8(slot?.flag ?? 0, base + 5);
    buffer.writeUInt16LE(0, base + 6); // padding do struct, sempre zero
  }
  for (let index = 0; index < MAX_RECIPE_MATERIALS; index += 1) {
    const base = offset + RECIPE_OFFSETS.materials + index * 8;
    const slot = values.materials[index];
    buffer.writeUInt32LE(slot?.tblidx ?? INVALID_TBLIDX, base);
    buffer.writeUInt8(slot?.quantity ?? 0, base + 4);
    buffer.writeUIntLE(0, base + 5, 3); // padding
  }
}

/**
 * Várias receitas com nomes e ícones resolvidos, para a tela.
 *
 * O índice de itens é montado uma vez para a chamada inteira. Montá-lo por receita percorreria
 * os ~20 mil itens 664 vezes numa listagem, e a tabela toda cabe numa página só de filtros.
 */
export async function resolveRecipes(tblidxs: number[]): Promise<RecipeEntry[]> {
  const [catalog, itemCatalog] = await Promise.all([loadRecipeCatalog(), loadItemCatalog()]);
  const items = new Map(itemCatalog.items.map((item) => [item.tblidx, item]));
  const describe = (id: number) => {
    const item = items.get(id);
    return { name: item?.name ?? `Item #${id}`, iconName: item?.iconName ?? "", missing: !item };
  };

  const resolvidas: RecipeEntry[] = [];
  for (const tblidx of tblidxs) {
    const offset = catalog.offsetByTblidx.get(tblidx);
    if (offset === undefined) continue;
    const values = readRecipeValues(catalog.buffer, offset);
    const recipeItem = items.get(tblidx);
    resolvidas.push({
      tblidx,
      name: recipeItem?.name ?? `Receita #${tblidx}`,
      iconName: recipeItem?.iconName ?? "",
      nameTextId: recipeItem?.nameTextId ?? 0,
      hasRecipeItem: recipeItem?.itemType === ITEM_TYPE_RECIPE,
      ...values,
      results: values.results.map((slot) => ({ ...slot, ...describe(slot.tblidx) })),
      materials: values.materials.map((slot) => ({ ...slot, ...describe(slot.tblidx) })),
    });
  }
  return resolvidas;
}

/** Uma receita só, para a rota de detalhe. */
export async function resolveRecipe(tblidx: number): Promise<RecipeEntry | null> {
  const [recipe] = await resolveRecipes([tblidx]);
  return recipe ?? null;
}

/**
 * Itens do tipo Receita que ainda não têm registro.
 *
 * São os candidatos para criar: 752 na base atual. Criar uma receita com um tblidx que não é
 * item-receita produziria um registro que ninguém consegue aprender, como já acontece com a
 * 10150002.
 */
export async function listRecipeItemCandidates(search: string, onlyWithoutRecipe: boolean) {
  const [catalog, itemCatalog] = await Promise.all([loadRecipeCatalog(), loadItemCatalog()]);
  const query = search.trim().toLocaleLowerCase();
  return itemCatalog.items
    .filter((item) => item.itemType === ITEM_TYPE_RECIPE)
    .filter((item) => !onlyWithoutRecipe || !catalog.offsetByTblidx.has(item.tblidx))
    .filter((item) => !query || item.name.toLocaleLowerCase().includes(query) || String(item.tblidx).includes(query))
    .slice(0, 40)
    .map((item) => ({
      tblidx: item.tblidx,
      name: item.name,
      iconName: item.iconName,
      nameTextId: item.nameTextId,
      hasRecipe: catalog.offsetByTblidx.has(item.tblidx),
    }));
}
