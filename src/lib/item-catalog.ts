import "server-only";

import { stat, readFile } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import type { ItemCatalogEntry } from "@/lib/types";

const HEADER_SIZE = 1;
const RECORD_SIZE = 372;
const HLS_RECORD_SIZE = 20;

type CatalogCache = {
  path: string;
  modifiedAt: number;
  size: number;
  textPath: string;
  textModifiedAt: number;
  textSize: number;
  items: ItemCatalogEntry[];
};

let catalogCache: CatalogCache | null = null;

function readFixedString(buffer: Buffer, offset: number, length: number) {
  const end = buffer.indexOf(0, offset);
  const safeEnd = end === -1 || end >= offset + length ? offset + length : end;
  return buffer.toString("latin1", offset, safeEnd).trim();
}

function readFixedUtf16(buffer: Buffer, offset: number, byteLength: number) {
  let end = offset;
  const limit = offset + byteLength;
  while (end + 1 < limit && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end).trim();
}

function parseItem(buffer: Buffer, offset: number, localizedNames: Map<number, string>): ItemCatalogEntry {
  const internalName = readFixedUtf16(buffer, offset + 12, 66);
  const tblidx = buffer.readUInt32LE(offset);
  const nameTextId = buffer.readUInt32LE(offset + 8);
  const noteTextId = buffer.readUInt32LE(offset + 248);

  return {
    tblidx,
    valid: buffer.readUInt8(offset + 4) !== 0,
    nameTextId,
    noteTextId,
    name: localizedNames.get(nameTextId) || internalName || `Item #${tblidx}`,
    description: localizedNames.get(noteTextId) || "",
    internalName,
    iconName: readFixedString(buffer, offset + 78, 33),
    modelName: readFixedString(buffer, offset + 112, 33),
    subWeaponModelName: readFixedString(buffer, offset + 145, 33),
    modelType: buffer.readUInt8(offset + 111),
    itemType: buffer.readUInt8(offset + 178),
    equipType: buffer.readUInt8(offset + 179),
    equipSlotFlag: buffer.readUInt32LE(offset + 180),
    functionFlag: buffer.readUInt16LE(offset + 184),
    maxStack: buffer.readUInt8(offset + 186),
    rank: buffer.readUInt8(offset + 187),
    weight: buffer.readUInt32LE(offset + 188),
    cost: buffer.readUInt32LE(offset + 192),
    sellPrice: buffer.readUInt32LE(offset + 196),
    durability: buffer.readUInt8(offset + 200),
    durabilityCount: buffer.readUInt8(offset + 201),
    battleAttribute: buffer.readUInt8(offset + 202),
    physicalOffence: buffer.readUInt16LE(offset + 204),
    energyOffence: buffer.readUInt16LE(offset + 206),
    physicalDefence: buffer.readUInt16LE(offset + 208),
    energyDefence: buffer.readUInt16LE(offset + 210),
    attackRangeBonus: buffer.readFloatLE(offset + 212),
    attackSpeedRate: buffer.readUInt16LE(offset + 216),
    minimumLevel: buffer.readUInt8(offset + 218),
    maximumLevel: buffer.readUInt8(offset + 219),
    classFlag: buffer.readUInt32LE(offset + 220),
    genderFlag: buffer.readUInt32LE(offset + 224),
    classSpecial: buffer.readUInt8(offset + 228),
    raceSpecial: buffer.readUInt8(offset + 229),
    needStr: buffer.readUInt16LE(offset + 230),
    needCon: buffer.readUInt16LE(offset + 232),
    needFoc: buffer.readUInt16LE(offset + 234),
    needDex: buffer.readUInt16LE(offset + 236),
    needSol: buffer.readUInt16LE(offset + 238),
    needEng: buffer.readUInt16LE(offset + 240),
    setItemTblidx: buffer.readUInt32LE(offset + 244),
    bagSize: buffer.readUInt8(offset + 252),
    scouterWatt: buffer.readUInt16LE(offset + 254),
    scouterMaxPower: buffer.readUInt32LE(offset + 256),
    scouterParts: [260, 261, 262, 263].map((fieldOffset) => buffer.readUInt8(offset + fieldOffset)),
    useItemTblidx: buffer.readUInt32LE(offset + 264),
    canHaveOption: buffer.readUInt8(offset + 268) !== 0,
    itemOptionTblidx: buffer.readUInt32LE(offset + 272),
    itemGroup: buffer.readUInt8(offset + 276),
    charmTblidx: buffer.readUInt32LE(offset + 280),
    costumeHideFlag: buffer.readUInt16LE(offset + 284),
    needItemTblidx: buffer.readUInt32LE(offset + 288),
    commonPoint: buffer.readUInt32LE(offset + 292),
    commonPointType: buffer.readUInt8(offset + 296),
    needFunction: buffer.readUInt8(offset + 297),
    useDurationMax: buffer.readUInt32LE(offset + 300),
    durationType: buffer.readUInt8(offset + 304),
    contentsTblidx: buffer.readUInt32LE(offset + 308),
    durationGroup: buffer.readUInt32LE(offset + 312),
    dropLevel: buffer.readUInt8(offset + 316),
    enchantRateTblidx: buffer.readUInt32LE(offset + 320),
    excellentTblidx: buffer.readUInt32LE(offset + 324),
    rareTblidx: buffer.readUInt32LE(offset + 328),
    legendaryTblidx: buffer.readUInt32LE(offset + 332),
    createSuperior: buffer.readUInt8(offset + 336) !== 0,
    createExcellent: buffer.readUInt8(offset + 337) !== 0,
    createRare: buffer.readUInt8(offset + 338) !== 0,
    createLegendary: buffer.readUInt8(offset + 339) !== 0,
    restrictType: buffer.readUInt8(offset + 340),
    attackPhysicalRevision: buffer.readFloatLE(offset + 344),
    attackEnergyRevision: buffer.readFloatLE(offset + 348),
    defencePhysicalRevision: buffer.readFloatLE(offset + 352),
    defenceEnergyRevision: buffer.readFloatLE(offset + 356),
    temporaryTableType: buffer.readUInt8(offset + 360),
    renewal: buffer.readUInt8(offset + 361) !== 0,
    disassembleFlag: buffer.readUInt16LE(offset + 362),
    disassembleNormalMin: buffer.readUInt8(offset + 364),
    disassembleNormalMax: buffer.readUInt8(offset + 365),
    disassembleUpperMin: buffer.readUInt8(offset + 366),
    disassembleUpperMax: buffer.readUInt8(offset + 367),
    dropVisual: buffer.readUInt8(offset + 368),
    useDisassemble: buffer.readUInt8(offset + 369),
  };
}

export function resolveItemCatalogPath() {
  return resolveServerTable("Table_Item_Data.rdf", "ITEM_TABLE_PATH");
}

export function resolveItemTextCatalogPath() {
  return resolveServerTable("table_text_all_data.rdf", "ITEM_TEXT_TABLE_PATH");
}

export function resolveCashShopCatalogPath() {
  return resolveServerTable("table_hls_item_data.rdf", "HLS_ITEM_TABLE_PATH");
}

export async function loadCashShopItemMappings() {
  const buffer = await readFile(/* turbopackIgnore: true */ resolveCashShopCatalogPath());
  if (buffer.length <= HEADER_SIZE || (buffer.length - HEADER_SIZE) % HLS_RECORD_SIZE !== 0) {
    throw new Error(`Formato de table_hls_item_data.rdf incompatível: ${buffer.length} bytes.`);
  }

  const mappings = new Map<number, { tblidx: number; stack: number; onSale: boolean }>();
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += HLS_RECORD_SIZE) {
    const tblidx = buffer.readUInt32LE(offset);
    const itemTblidx = buffer.readUInt32LE(offset + 4);
    const onSale = buffer.readUInt8(offset + 9) !== 0;
    const stack = Math.max(1, buffer.readUInt8(offset + 16));
    const current = mappings.get(itemTblidx);
    if (!current || (onSale && !current.onSale)) mappings.set(itemTblidx, { tblidx, stack, onSale });
  }
  return mappings;
}

function parseLocalizedItemNames(buffer: Buffer) {
  const names = new Map<number, string>();
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const tableType = buffer.readInt32LE(offset);
    const payloadLength = buffer.readInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadLength < 1 || payloadEnd > buffer.length) {
      throw new Error("Formato de table_text_all_data.rdf incompatível.");
    }

    if (tableType === 3) {
      let textOffset = payloadStart + 1;
      while (textOffset < payloadEnd) {
        if (textOffset + 6 > payloadEnd) {
          throw new Error("Registro de texto de item incompleto.");
        }
        const textId = buffer.readUInt32LE(textOffset);
        const textLength = buffer.readUInt16LE(textOffset + 4);
        const byteLength = textLength * 2;
        textOffset += 6;
        if (textOffset + byteLength > payloadEnd) {
          throw new Error("Texto de item ultrapassa o tamanho da tabela.");
        }
        names.set(textId, buffer.toString("utf16le", textOffset, textOffset + byteLength));
        textOffset += byteLength;
      }
      return names;
    }

    offset = payloadEnd;
  }

  throw new Error("A seção de nomes dos itens não foi encontrada na tabela de textos.");
}

export async function loadItemCatalog() {
  const catalogPath = resolveItemCatalogPath();
  const textPath = resolveItemTextCatalogPath();
  const fileStat = await stat(/* turbopackIgnore: true */ catalogPath);
  const textStat = await stat(/* turbopackIgnore: true */ textPath);

  if (
    catalogCache?.path === catalogPath &&
    catalogCache.modifiedAt === fileStat.mtimeMs &&
    catalogCache.size === fileStat.size &&
    catalogCache.textPath === textPath &&
    catalogCache.textModifiedAt === textStat.mtimeMs &&
    catalogCache.textSize === textStat.size
  ) {
    return catalogCache;
  }

  const buffer = await readFile(/* turbopackIgnore: true */ catalogPath);
  const textBuffer = await readFile(/* turbopackIgnore: true */ textPath);
  if (buffer.length <= HEADER_SIZE || (buffer.length - HEADER_SIZE) % RECORD_SIZE !== 0) {
    throw new Error(
      `Formato de Table_Item_Data.rdf incompatível: ${buffer.length} bytes.`,
    );
  }

  const localizedNames = parseLocalizedItemNames(textBuffer);
  const items: ItemCatalogEntry[] = [];
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += RECORD_SIZE) {
    items.push(parseItem(buffer, offset, localizedNames));
  }

  catalogCache = {
    path: catalogPath,
    modifiedAt: fileStat.mtimeMs,
    size: fileStat.size,
    textPath,
    textModifiedAt: textStat.mtimeMs,
    textSize: textStat.size,
    items,
  };
  return catalogCache;
}
