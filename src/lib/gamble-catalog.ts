import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import { loadItemCatalog } from "@/lib/item-catalog";
import type { GambleReward, GambleRewardsResponse } from "@/lib/types";

/**
 * O que um item do tipo "Aposta" devolve quando é usado.
 *
 * O caminho tem três arquivos e está em `CItem::Use` (item.cpp, `case ACTIVE_GAMBLE_ITEM`):
 *
 *   1. Table_Item_Data.rdf          o item é do tipo 40 (ITEM_TYPE_GAMBLE)
 *   2. Table_Use_Item_Data.rdf      um dos dois efeitos é 515 (ACTIVE_GAMBLE_ITEM), e o
 *                                   valor do efeito guarda o TBLIDX do sorteio
 *   3. table_quest_probability_data.rdf  a lista de prêmios, com chance e quantidade
 *
 * Conferido nos dados: 713 itens são do tipo Aposta, 700 têm o efeito 515, e todas as 6.190
 * entradas de prêmio são do tipo 0 (eREWARD_TYPE_NORMAL_ITEM) -- não há outro tipo de prêmio
 * para tratar nesta base.
 */

const HEADER_SIZE = 1;
const USE_ITEM_RECORD_SIZE = 220;
const PROBABILITY_RECORD_SIZE = 1656;
const PROBABILITY_ENTRY_SIZE = 20;
const MAX_PROBABILITY_ENTRIES = 50;

/** eSYSTEM_EFFECT_CODE::ACTIVE_GAMBLE_ITEM, resolvido em Table_System_Effect_Data. */
const GAMBLE_EFFECT_TBLIDX = 515;
/** eITEM_TYPE::ITEM_TYPE_GAMBLE. */
export const ITEM_TYPE_GAMBLE = 40;
/** eREWARD_TYPE::eREWARD_TYPE_NORMAL_ITEM. */
const REWARD_TYPE_NORMAL_ITEM = 0;
const INVALID_TBLIDX = 0xffffffff;

const USE_ITEM_OFFSETS = { systemEffect: 40, systemEffectValue: 52 } as const;
const PROBABILITY_OFFSETS = { name: 4, useType: 648, count: 654, entries: 656 } as const;
const ENTRY_OFFSETS = { type: 0, tblidx: 4, minValue: 8, maxValue: 12, rate: 16 } as const;

/**
 * ePROBABILITY_USE_TYPE decide quantos prêmios saem de uma vez, e a diferença é grande.
 *
 * Em `GAMBLE_SHOP` o servidor junta tudo que passou no sorteio e entrega **um só**, escolhido
 * ao acaso entre eles. Em `GAMBLE_ITEM` ele entrega **todos** que passaram. Nos dois casos, se
 * nada passar o servidor repete o sorteio, então sempre sai alguma coisa.
 */
const USE_TYPE_GAMBLE_SHOP = 3;
const USE_TYPE_GAMBLE_ITEM = 4;

type GambleCache = {
  useItemPath: string; useItemModifiedAt: number; useItemSize: number;
  probabilityPath: string; probabilityModifiedAt: number; probabilitySize: number;
  /** TBLIDX do item -> TBLIDX do sorteio. */
  gambleByItem: Map<number, number>;
  probabilityOffsets: Map<number, number>;
  probabilityBuffer: Buffer;
};

let gambleCache: GambleCache | null = null;

function readFixedUtf16(buffer: Buffer, offset: number, byteLength: number) {
  let end = offset;
  while (end + 1 < offset + byteLength && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end).trim();
}

export function resolveUseItemCatalogPath() {
  return resolveServerTable("Table_Use_Item_Data.rdf", "USE_ITEM_TABLE_PATH");
}

export function resolveQuestProbabilityPath() {
  return resolveServerTable("table_quest_probability_data.rdf", "QUEST_PROBABILITY_TABLE_PATH");
}

export async function loadGambleCatalog() {
  const useItemPath = resolveUseItemCatalogPath();
  const probabilityPath = resolveQuestProbabilityPath();
  const [useItemStat, probabilityStat] = await Promise.all([
    stat(/* turbopackIgnore: true */ useItemPath),
    stat(/* turbopackIgnore: true */ probabilityPath),
  ]);

  if (
    gambleCache?.useItemPath === useItemPath && gambleCache.useItemModifiedAt === useItemStat.mtimeMs && gambleCache.useItemSize === useItemStat.size &&
    gambleCache.probabilityPath === probabilityPath && gambleCache.probabilityModifiedAt === probabilityStat.mtimeMs && gambleCache.probabilitySize === probabilityStat.size
  ) {
    return gambleCache;
  }

  const [useItemBuffer, probabilityBuffer] = await Promise.all([
    readFile(/* turbopackIgnore: true */ useItemPath),
    readFile(/* turbopackIgnore: true */ probabilityPath),
  ]);
  if (useItemBuffer.length <= HEADER_SIZE || (useItemBuffer.length - HEADER_SIZE) % USE_ITEM_RECORD_SIZE !== 0) {
    throw new Error(`Formato de Table_Use_Item_Data.rdf incompatível: ${useItemBuffer.length} bytes.`);
  }
  if (probabilityBuffer.length <= HEADER_SIZE || (probabilityBuffer.length - HEADER_SIZE) % PROBABILITY_RECORD_SIZE !== 0) {
    throw new Error(`Formato de table_quest_probability_data.rdf incompatível: ${probabilityBuffer.length} bytes.`);
  }

  const gambleByItem = new Map<number, number>();
  for (let offset = HEADER_SIZE; offset < useItemBuffer.length; offset += USE_ITEM_RECORD_SIZE) {
    const effects = [0, 1].map((index) => useItemBuffer.readUInt32LE(offset + USE_ITEM_OFFSETS.systemEffect + index * 4));
    const slot = effects.indexOf(GAMBLE_EFFECT_TBLIDX);
    if (slot === -1) continue;
    // aSystem_Effect_Value é double; aqui ele guarda um TBLIDX inteiro.
    const probabilityTblidx = Math.round(useItemBuffer.readDoubleLE(offset + USE_ITEM_OFFSETS.systemEffectValue + slot * 8));
    if (!Number.isFinite(probabilityTblidx) || probabilityTblidx <= 0) continue;
    gambleByItem.set(useItemBuffer.readUInt32LE(offset), probabilityTblidx);
  }

  const probabilityOffsets = new Map<number, number>();
  for (let offset = HEADER_SIZE; offset < probabilityBuffer.length; offset += PROBABILITY_RECORD_SIZE) {
    probabilityOffsets.set(probabilityBuffer.readUInt32LE(offset), offset);
  }

  gambleCache = {
    useItemPath, useItemModifiedAt: useItemStat.mtimeMs, useItemSize: useItemStat.size,
    probabilityPath, probabilityModifiedAt: probabilityStat.mtimeMs, probabilitySize: probabilityStat.size,
    gambleByItem, probabilityOffsets, probabilityBuffer,
  };
  return gambleCache;
}

/** Os prêmios possíveis de um item de aposta, ou null se ele não for uma caixa. */
export async function resolveGambleRewards(itemTblidx: number): Promise<GambleRewardsResponse | null> {
  const [catalog, itemCatalog] = await Promise.all([loadGambleCatalog(), loadItemCatalog()]);
  const item = itemCatalog.items.find((entry) => entry.tblidx === itemTblidx);
  if (!item) return null;

  const warnings: string[] = [];
  const probabilityTblidx = catalog.gambleByItem.get(itemTblidx);
  if (probabilityTblidx === undefined) {
    if (item.itemType !== ITEM_TYPE_GAMBLE) return null;
    warnings.push("Este item é do tipo Aposta, mas não tem o efeito de sorteio em Table_Use_Item_Data.rdf. Usá-lo não devolve nada.");
    return { item: { tblidx: item.tblidx, name: item.name, iconName: item.iconName, itemType: item.itemType }, probabilityTblidx: null, probabilityName: "", drawMode: "none", rewards: [], warnings };
  }

  const offset = catalog.probabilityOffsets.get(probabilityTblidx);
  if (offset === undefined) {
    warnings.push(`O sorteio ${probabilityTblidx} não existe em table_quest_probability_data.rdf. Usar o item falha no servidor.`);
    return { item: { tblidx: item.tblidx, name: item.name, iconName: item.iconName, itemType: item.itemType }, probabilityTblidx, probabilityName: "", drawMode: "none", rewards: [], warnings };
  }

  const buffer = catalog.probabilityBuffer;
  const useType = buffer.readUInt32LE(offset + PROBABILITY_OFFSETS.useType);
  const declared = buffer.readUInt8(offset + PROBABILITY_OFFSETS.count);
  const usable = Math.min(declared, MAX_PROBABILITY_ENTRIES);
  if (declared > MAX_PROBABILITY_ENTRIES) warnings.push(`O sorteio declara ${declared} prêmios, mas o registro só comporta ${MAX_PROBABILITY_ENTRIES}; o excedente não existe no arquivo.`);

  const items = new Map(itemCatalog.items.map((entry) => [entry.tblidx, entry]));
  const rewards: GambleReward[] = [];
  for (let index = 0; index < usable; index += 1) {
    const entry = offset + PROBABILITY_OFFSETS.entries + index * PROBABILITY_ENTRY_SIZE;
    const tblidx = buffer.readUInt32LE(entry + ENTRY_OFFSETS.tblidx);
    if (tblidx === INVALID_TBLIDX || tblidx === 0) continue;
    const type = buffer.readUInt8(entry + ENTRY_OFFSETS.type);
    const reward = items.get(tblidx);
    rewards.push({
      tblidx,
      name: reward?.name ?? `Item #${tblidx}`,
      iconName: reward?.iconName ?? "",
      rank: reward?.rank ?? 0,
      minQuantity: buffer.readUInt32LE(entry + ENTRY_OFFSETS.minValue),
      maxQuantity: buffer.readUInt32LE(entry + ENTRY_OFFSETS.maxValue),
      // Dbo_CheckProbabilityF sorteia em 0..100 e o servidor passa dwRate/10000.
      chance: buffer.readUInt32LE(entry + ENTRY_OFFSETS.rate) / 10000,
      missing: !reward,
      unsupportedType: type !== REWARD_TYPE_NORMAL_ITEM,
    });
  }

  if (!rewards.length) warnings.push("O sorteio existe mas não tem nenhum prêmio preenchido.");
  const missing = rewards.filter((reward) => reward.missing).length;
  if (missing) warnings.push(`${missing} prêmio(s) apontam para itens que não existem em Table_Item_Data.rdf.`);
  const unsupported = rewards.filter((reward) => reward.unsupportedType).length;
  if (unsupported) warnings.push(`${unsupported} prêmio(s) não são do tipo item comum; o servidor registra erro e falha ao usar.`);

  return {
    item: { tblidx: item.tblidx, name: item.name, iconName: item.iconName, itemType: item.itemType },
    probabilityTblidx,
    probabilityName: readFixedUtf16(buffer, offset + PROBABILITY_OFFSETS.name, 130),
    drawMode: useType === USE_TYPE_GAMBLE_SHOP ? "one" : useType === USE_TYPE_GAMBLE_ITEM ? "each" : "none",
    rewards,
    warnings,
  };
}
