import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import { loadItemCatalog } from "@/lib/item-catalog";
import { loadMobCatalog } from "@/lib/mob-catalog";
import type { MobDropBag, MobDropGroup, MobDropItem, MobDropSection } from "@/lib/types";

/**
 * De onde sai o drop de um mob.
 *
 * Nao existe uma coluna "itens que este mob dropa". O GameServer monta a lista em
 * CItemManager::CreateItemDrop (ItemManager.cpp) percorrendo dois arquivos:
 *
 *   table_item_group_list_data.rdf  grupos de drop; cada um aponta para ate 20 bags
 *   table_item_bag_list_data.rdf    bags; cada uma lista ate 20 itens com probabilidade
 *
 * Um grupo chega ate o mob por tres caminhos, e a regra de qual caminho vale esta em
 * CItemGroupListTable::AddTable:
 *
 *   1. mob_Index aponta para o tblidx do mob   -> drop exclusivo (quest, dungeon, boss)
 *   2. senao, dwWorld_Rule_Type                -> drop da regiao, filtrado por nivel
 *   3. em paralelo, dwMob_Type                 -> usado so quando o mob e caixa de item
 *
 * O `senao` do caminho 2 e literal: um grupo com mob_Index valido nunca entra na lista
 * por regra de mundo, mesmo que tenha dwWorld_Rule_Type preenchido.
 */

export const DROP_HEADER_SIZE = 1;
export const DROP_GROUP_RECORD_SIZE = 296;
export const DROP_BAG_RECORD_SIZE = 256;
export const MAX_BAGS_PER_GROUP = 20;
export const MAX_ITEMS_PER_BAG = 20;
export const DROP_INVALID_TBLIDX = 0xffffffff;

const HEADER_SIZE = DROP_HEADER_SIZE;
const GROUP_RECORD_SIZE = DROP_GROUP_RECORD_SIZE;
const BAG_RECORD_SIZE = DROP_BAG_RECORD_SIZE;
const INVALID_TBLIDX = DROP_INVALID_TBLIDX;
const INVALID_BYTE = 0xff;

/** Posição de cada campo gravável dentro do registro, usada também pelo publicador. */
export const DROP_GROUP_OFFSETS = {
  level: 86, tryCount: 87, superior: 104, excellent: 108, rare: 112, legendary: 116,
  zenny: 124, bags: 128, probabilities: 208, count: 288, totalProbability: 292,
} as const;

export const DROP_BAG_OFFSETS = {
  level: 86, enchantAble: 87, items: 88, probabilities: 168, count: 248, totalProbability: 252,
} as const;

/** eMOB_TYPE::MOB_TYPE_ITEM_BOX, em NtlCharacter.h. */
const MOB_TYPE_ITEM_BOX = 15;

/** eGAMERULE_TYPE, em NtlWorld.h. dwWorld_Rule_Type e um bitflag sobre estes indices. */
const GAME_RULE_NAMES = [
  "Mundo normal", "Batalha de ranque", "Torneio Mudosa", "Dojo", "Raide",
  "Masmorra definitiva", "Time Quest", "Tutorial", "Budokai - eliminatoria",
  "Budokai - principal", "Budokai - final", "Budokai mundial", "TLQ", "DWC",
  "Masmorra CC", "Masmorra do ceu",
];

export type RawGroup = {
  tblidx: number; name: string; level: number; tryCount: number;
  mobIndex: number; mobType: number; worldRule: number;
  zenny: number; superior: number; excellent: number; rare: number; legendary: number; noDrop: number;
  bags: number[]; probabilities: number[]; declaredBagCount: number; totalProbability: number;
};

export type RawBag = {
  tblidx: number; name: string; level: number; enchantAble: boolean;
  items: number[]; probabilities: number[]; declaredItemCount: number; totalProbability: number;
};

type DropCache = {
  groupPath: string; groupModifiedAt: number; groupSize: number;
  bagPath: string; bagModifiedAt: number; bagSize: number;
  groups: RawGroup[];
  bagsByTblidx: Map<number, RawBag>;
  /** Grupos com mob_Index valido, agrupados pelo mob. Caminho 1. */
  groupsByMob: Map<number, RawGroup[]>;
  /** Grupos por indice de eGAMERULE_TYPE, ordenados por nivel como o multimap do servidor. Caminho 2. */
  groupsByWorldRule: Map<number, RawGroup[]>;
  /** Grupos por indice de eMOB_TYPE, tambem ordenados por nivel. Caminho 3. */
  groupsByMobType: Map<number, RawGroup[]>;
};

let dropCache: DropCache | null = null;

/**
 * Descarta o cache depois de uma publicação.
 *
 * O cache normalmente se invalida sozinho por mtime/tamanho, mas uma gravação pode cair no
 * mesmo milissegundo e manter o mesmo tamanho -- o registro tem largura fixa. Sem isto o
 * painel mostraria o valor antigo logo depois de publicar.
 */
export function invalidateDropCatalogCache() {
  dropCache = null;
}

function readFixedUtf16(buffer: Buffer, offset: number, byteLength: number) {
  let end = offset;
  while (end + 1 < offset + byteLength && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end).trim();
}

function readTblidxArray(buffer: Buffer, offset: number, count: number) {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) values.push(buffer.readUInt32LE(offset + index * 4));
  return values;
}

function parseGroup(buffer: Buffer, offset: number): RawGroup {
  return {
    tblidx: buffer.readUInt32LE(offset),
    name: readFixedUtf16(buffer, offset + 4, 82),
    level: buffer.readUInt8(offset + 86),
    tryCount: buffer.readUInt8(offset + 87),
    mobIndex: buffer.readUInt32LE(offset + 88),
    mobType: buffer.readUInt32LE(offset + 92),
    worldRule: buffer.readUInt32LE(offset + 96),
    superior: buffer.readUInt32LE(offset + 104),
    excellent: buffer.readUInt32LE(offset + 108),
    rare: buffer.readUInt32LE(offset + 112),
    legendary: buffer.readUInt32LE(offset + 116),
    noDrop: buffer.readUInt32LE(offset + 120),
    zenny: buffer.readUInt32LE(offset + 124),
    bags: readTblidxArray(buffer, offset + 128, MAX_BAGS_PER_GROUP),
    probabilities: readTblidxArray(buffer, offset + 208, MAX_BAGS_PER_GROUP),
    declaredBagCount: buffer.readUInt32LE(offset + 288),
    totalProbability: buffer.readUInt32LE(offset + 292),
  };
}

function parseBag(buffer: Buffer, offset: number): RawBag {
  return {
    tblidx: buffer.readUInt32LE(offset),
    name: readFixedUtf16(buffer, offset + 4, 82),
    level: buffer.readUInt8(offset + 86),
    enchantAble: buffer.readUInt8(offset + 87) !== 0,
    items: readTblidxArray(buffer, offset + 88, MAX_ITEMS_PER_BAG),
    probabilities: readTblidxArray(buffer, offset + 168, MAX_ITEMS_PER_BAG),
    declaredItemCount: buffer.readUInt32LE(offset + 248),
    totalProbability: buffer.readUInt32LE(offset + 252),
  };
}

/**
 * Quantas posicoes do array realmente valem.
 *
 * O campo de contagem da tabela nao e confiavel: o grupo 333 (SKD1(C) 003_2) declara 30
 * bags num array de 20. O GameServer percorre o contador cru e le fora do array; aqui o
 * limite e o tamanho real, e a divergencia vira aviso na tela.
 */
function usableCount(declared: number, limit: number) {
  return Math.min(declared, limit);
}

export function resolveDropGroupPath() {
  return resolveServerTable("table_item_group_list_data.rdf", "DROP_GROUP_TABLE_PATH");
}

export function resolveDropBagPath() {
  return resolveServerTable("table_item_bag_list_data.rdf", "DROP_BAG_TABLE_PATH");
}

export async function loadDropCatalog() {
  const groupPath = resolveDropGroupPath();
  const bagPath = resolveDropBagPath();
  const [groupStat, bagStat] = await Promise.all([
    stat(/* turbopackIgnore: true */ groupPath),
    stat(/* turbopackIgnore: true */ bagPath),
  ]);

  if (
    dropCache?.groupPath === groupPath && dropCache.groupModifiedAt === groupStat.mtimeMs && dropCache.groupSize === groupStat.size &&
    dropCache.bagPath === bagPath && dropCache.bagModifiedAt === bagStat.mtimeMs && dropCache.bagSize === bagStat.size
  ) {
    return dropCache;
  }

  const [groupBuffer, bagBuffer] = await Promise.all([
    readFile(/* turbopackIgnore: true */ groupPath),
    readFile(/* turbopackIgnore: true */ bagPath),
  ]);
  if (groupBuffer.length <= HEADER_SIZE || (groupBuffer.length - HEADER_SIZE) % GROUP_RECORD_SIZE !== 0) {
    throw new Error(`Formato de table_item_group_list_data.rdf incompatível: ${groupBuffer.length} bytes.`);
  }
  if (bagBuffer.length <= HEADER_SIZE || (bagBuffer.length - HEADER_SIZE) % BAG_RECORD_SIZE !== 0) {
    throw new Error(`Formato de table_item_bag_list_data.rdf incompatível: ${bagBuffer.length} bytes.`);
  }

  const groups: RawGroup[] = [];
  for (let offset = HEADER_SIZE; offset < groupBuffer.length; offset += GROUP_RECORD_SIZE) {
    groups.push(parseGroup(groupBuffer, offset));
  }
  const bagsByTblidx = new Map<number, RawBag>();
  for (let offset = HEADER_SIZE; offset < bagBuffer.length; offset += BAG_RECORD_SIZE) {
    const bag = parseBag(bagBuffer, offset);
    bagsByTblidx.set(bag.tblidx, bag);
  }

  // Os tres indices reproduzem CItemGroupListTable::AddTable, inclusive o `else if`.
  const groupsByMob = new Map<number, RawGroup[]>();
  const groupsByWorldRule = new Map<number, RawGroup[]>();
  const groupsByMobType = new Map<number, RawGroup[]>();
  const pushInto = (index: Map<number, RawGroup[]>, key: number, group: RawGroup) => {
    const bucket = index.get(key);
    if (bucket) bucket.push(group);
    else index.set(key, [group]);
  };

  for (const group of groups) {
    if (group.mobIndex !== INVALID_TBLIDX && group.mobIndex > 0) {
      pushInto(groupsByMob, group.mobIndex, group);
    } else if (group.worldRule !== INVALID_TBLIDX && group.worldRule > 0) {
      for (let bit = 0; bit < GAME_RULE_NAMES.length; bit += 1) {
        if ((group.worldRule & (1 << bit)) !== 0) pushInto(groupsByWorldRule, bit, group);
      }
    }
    if (group.mobType !== INVALID_TBLIDX && group.mobType > 0) {
      for (let bit = 0; bit < 16; bit += 1) {
        if ((group.mobType & (1 << bit)) !== 0) pushInto(groupsByMobType, bit, group);
      }
    }
  }

  // O servidor guarda estes dois indices em multimap ordenado por nivel e varre com
  // lower_bound + break. Ordenar aqui deixa a janela de nivel ser o mesmo intervalo continuo.
  for (const bucket of groupsByWorldRule.values()) bucket.sort((left, right) => left.level - right.level);
  for (const bucket of groupsByMobType.values()) bucket.sort((left, right) => left.level - right.level);

  dropCache = {
    groupPath, groupModifiedAt: groupStat.mtimeMs, groupSize: groupStat.size,
    bagPath, bagModifiedAt: bagStat.mtimeMs, bagSize: bagStat.size,
    groups, bagsByTblidx, groupsByMob, groupsByWorldRule, groupsByMobType,
  };
  return dropCache;
}

/**
 * Janela de nivel dos caminhos 2 e 3 (AccumulateItemGroupListByWorldRuleType / ...ByMobType).
 *
 * O servidor parte de `nivel do mob - 5` e para no primeiro grupo acima de
 * `nivel do matador + 5` ou mais de 10 niveis adiante do piso. Como o painel nao sabe quem
 * vai matar o mob, assume um matador no nivel do proprio mob -- e ai os dois limites
 * coincidem em `nivel do mob + 5`, que e a janela tipica.
 */
function levelWindow(mobLevel: number) {
  const floor = mobLevel >= 5 ? mobLevel - 5 : 0;
  return { floor, ceiling: Math.min(mobLevel + 5, floor + 10) };
}

/** Janela do caminho 1, em AccumulateItemGroupListByMobTblidx. Nivel 255 passa sempre. */
function matchesMobWindow(groupLevel: number, mobLevel: number) {
  if (groupLevel === INVALID_BYTE) return true;
  if (mobLevel >= 5) return groupLevel >= mobLevel - 5 && groupLevel <= (mobLevel <= 250 ? mobLevel + 5 : INVALID_BYTE);
  return groupLevel <= mobLevel + 5;
}

function buildBags(group: RawGroup, cache: DropCache, items: Map<number, { name: string; iconName: string; rank: number; itemType: number }>) {
  const bags: MobDropBag[] = [];
  for (let slot = 0; slot < usableCount(group.declaredBagCount, MAX_BAGS_PER_GROUP); slot += 1) {
    const bagId = group.bags[slot];
    if (!bagId || bagId === INVALID_TBLIDX) continue;
    const bag = cache.bagsByTblidx.get(bagId);
    if (!bag) {
      bags.push({ tblidx: bagId, name: `Bag #${bagId}`, level: 0, enchantAble: false, probability: group.probabilities[slot], totalProbability: 0, missing: true, items: [] });
      continue;
    }

    const bagItems: MobDropItem[] = [];
    for (let position = 0; position < usableCount(bag.declaredItemCount, MAX_ITEMS_PER_BAG); position += 1) {
      const itemId = bag.items[position];
      if (!itemId || itemId === INVALID_TBLIDX) continue;
      const item = items.get(itemId);
      bagItems.push({
        tblidx: itemId,
        name: item?.name ?? `Item #${itemId}`,
        iconName: item?.iconName ?? "",
        rank: item?.rank ?? 0,
        itemType: item?.itemType ?? 0,
        probability: bag.probabilities[position],
        missing: !item,
      });
    }

    bags.push({
      tblidx: bag.tblidx, name: bag.name || `Bag #${bag.tblidx}`, level: bag.level,
      enchantAble: bag.enchantAble, probability: group.probabilities[slot],
      totalProbability: bag.totalProbability, missing: false, items: bagItems,
    });
  }
  return bags;
}

function toGroup(group: RawGroup, cache: DropCache, items: Parameters<typeof buildBags>[2]): MobDropGroup {
  const bags = buildBags(group, cache, items);
  return {
    tblidx: group.tblidx,
    name: group.name || `Grupo #${group.tblidx}`,
    level: group.level,
    tryCount: group.tryCount,
    // O `if (mob_Index != INVALID_TBLIDX && dwItemBagCount > 0)` de CreateItemDrop: nesse
    // ramo o servidor junta os itens de todas as bags e sorteia UM com peso igual, ignorando
    // as probabilidades da tabela. So grupos de mob especifico caem ai.
    uniformDraw: group.mobIndex !== INVALID_TBLIDX && group.declaredBagCount > 0,
    zenny: group.zenny,
    superior: group.superior, excellent: group.excellent, rare: group.rare, legendary: group.legendary,
    declaredBagCount: group.declaredBagCount,
    overflow: group.declaredBagCount > MAX_BAGS_PER_GROUP,
    bags,
  };
}

/** Todos os itens que podem cair de um mob, separados pelo caminho que os traz. */
export async function resolveMobDrops(mobTblidx: number) {
  const [dropCatalog, mobCatalog, itemCatalog] = await Promise.all([loadDropCatalog(), loadMobCatalog(), loadItemCatalog()]);
  const mob = mobCatalog.mobs.find((candidate) => candidate.tblidx === mobTblidx);
  if (!mob) return null;

  const items = new Map(itemCatalog.items.map((item) => [item.tblidx, { name: item.name, iconName: item.iconName, rank: item.rank, itemType: item.itemType }]));
  const sections: MobDropSection[] = [];

  // 1. Grupos presos a este mob. Entram todos os que passam na janela de nivel -- nao ha sorteio.
  const ownGroups = (dropCatalog.groupsByMob.get(mob.tblidx) ?? []).filter((group) => matchesMobWindow(group.level, mob.level));
  if (ownGroups.length) {
    sections.push({
      source: "mob", label: "Drop exclusivo deste mob", ruleName: null, drawsOneGroup: false,
      note: "Todos estes grupos rodam a cada morte.",
      groups: ownGroups.map((group) => toGroup(group, dropCatalog, items)),
    });
  }

  // 2. Grupos da regiao. O servidor usa a regra do mundo em que o matador esta e sorteia UM
  // grupo entre os candidatos, entao cada regra vira uma secao propria.
  const { floor, ceiling } = levelWindow(mob.level);
  for (const [bit, bucket] of [...dropCatalog.groupsByWorldRule.entries()].sort((left, right) => left[0] - right[0])) {
    const candidates = bucket.filter((group) => group.level >= floor && group.level <= ceiling);
    if (!candidates.length) continue;
    sections.push({
      source: "world", label: "Drop da região", ruleName: GAME_RULE_NAMES[bit] ?? `Regra ${bit}`, drawsOneGroup: true,
      note: `Vale quando o mob é morto num mundo com esta regra. O servidor sorteia 1 grupo entre os ${candidates.length} candidatos de nível ${floor} a ${ceiling}.`,
      groups: candidates.map((group) => toGroup(group, dropCatalog, items)),
    });
  }

  // 3. Caixa de item. CreateItemDrop so chama este caminho quando o mob e MOB_TYPE_ITEM_BOX.
  if (mob.mobType === MOB_TYPE_ITEM_BOX) {
    const candidates = (dropCatalog.groupsByMobType.get(MOB_TYPE_ITEM_BOX) ?? []).filter((group) => group.level >= floor && group.level <= ceiling);
    if (candidates.length) {
      sections.push({
        source: "itemBox", label: "Caixa de item", ruleName: null, drawsOneGroup: true,
        note: `O servidor sorteia 1 grupo entre os ${candidates.length} candidatos de nível ${floor} a ${ceiling}.`,
        groups: candidates.map((group) => toGroup(group, dropCatalog, items)),
      });
    }
  }

  const warnings: string[] = [];
  const overflowing = sections.flatMap((section) => section.groups).filter((group) => group.overflow);
  if (overflowing.length) {
    warnings.push(`${overflowing.length} grupo(s) declaram mais de ${MAX_BAGS_PER_GROUP} bags; o excedente não existe no arquivo e foi ignorado.`);
  }
  const missingBags = sections.flatMap((section) => section.groups).flatMap((group) => group.bags).filter((bag) => bag.missing);
  if (missingBags.length) {
    warnings.push(`${missingBags.length} bag(s) referenciadas não existem em table_item_bag_list_data.rdf.`);
  }
  const missingItems = sections.flatMap((section) => section.groups).flatMap((group) => group.bags).flatMap((bag) => bag.items).filter((item) => item.missing);
  if (missingItems.length) {
    warnings.push(`${missingItems.length} item(ns) referenciados não existem em Table_Item_Data.rdf.`);
  }

  return {
    mob: { tblidx: mob.tblidx, name: mob.name, level: mob.level, mobType: mob.mobType, dropZenny: mob.dropZenny, dropZennyRate: mob.dropZennyRate, dragonBallDrop: mob.dragonBallDrop },
    sections,
    warnings,
    levelWindow: { floor, ceiling },
    sourceUpdatedAt: new Date(Math.max(dropCatalog.groupModifiedAt, dropCatalog.bagModifiedAt)).toISOString(),
  };
}

/** Um registro cru, para o editor preencher o formulário. */
export async function findDropRecord(target: "group" | "bag", tblidx: number) {
  const cache = await loadDropCatalog();
  return target === "bag"
    ? cache.bagsByTblidx.get(tblidx) ?? null
    : cache.groups.find((group) => group.tblidx === tblidx) ?? null;
}

/**
 * Quem mais sente a edição.
 *
 * Uma bag é compartilhada: a bag 1 aparece em dezenas de grupos, e editá-la muda o drop de
 * todos os mobs que passam por eles. Um grupo de regra de mundo alcança qualquer mob na
 * faixa de nível daquela regra, então o número de mobs afetados não é enumerável -- o campo
 * `reachesWholeRegion` existe para a tela avisar em vez de mentir um total.
 */
export async function describeDropUsage(target: "group" | "bag", tblidx: number) {
  const cache = await loadDropCatalog();
  const groups = target === "bag"
    ? cache.groups.filter((group) => group.bags.slice(0, Math.min(group.declaredBagCount, MAX_BAGS_PER_GROUP)).includes(tblidx))
    : cache.groups.filter((group) => group.tblidx === tblidx);

  const mobTblidxs = new Set<number>();
  let reachesWholeRegion = false;
  for (const group of groups) {
    if (group.mobIndex !== INVALID_TBLIDX && group.mobIndex > 0) mobTblidxs.add(group.mobIndex);
    else if (group.worldRule > 0) reachesWholeRegion = true;
    if (group.mobType > 0 && group.mobType !== INVALID_TBLIDX) reachesWholeRegion = true;
  }

  const mobCatalog = await loadMobCatalog();
  const mobs = [...mobTblidxs]
    .map((id) => mobCatalog.mobs.find((mob) => mob.tblidx === id))
    .filter((mob): mob is NonNullable<typeof mob> => Boolean(mob))
    .map((mob) => ({ tblidx: mob.tblidx, name: mob.name, level: mob.level }));

  return {
    groups: groups.map((group) => ({ tblidx: group.tblidx, name: group.name || `Grupo #${group.tblidx}` })),
    mobs: mobs.sort((left, right) => left.level - right.level),
    reachesWholeRegion,
  };
}
