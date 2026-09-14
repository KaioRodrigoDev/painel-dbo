import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import type { MobCatalogEntry } from "@/lib/types";

const HEADER_SIZE = 1;
const RECORD_SIZE = 584;
const MOB_TEXT_SECTION = 5;

type CatalogCache = {
  path: string; modifiedAt: number; size: number;
  textPath: string; textModifiedAt: number; textSize: number;
  mobs: MobCatalogEntry[];
};

let catalogCache: CatalogCache | null = null;

function readFixedString(buffer: Buffer, offset: number, length: number) {
  const end = buffer.indexOf(0, offset);
  return buffer.toString("latin1", offset, end === -1 || end >= offset + length ? offset + length : end).trim();
}

function readFixedUtf16(buffer: Buffer, offset: number, byteLength: number) {
  let end = offset;
  while (end + 1 < offset + byteLength && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end).trim();
}

function parseMobText(buffer: Buffer) {
  const text = new Map<number, string>();
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const section = buffer.readInt32LE(offset);
    const payloadLength = buffer.readInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadLength < 1 || payloadEnd > buffer.length) throw new Error("Formato da tabela de textos incompatível.");
    if (section === MOB_TEXT_SECTION) {
      let cursor = payloadStart + 1;
      while (cursor < payloadEnd) {
        if (cursor + 6 > payloadEnd) throw new Error("Registro de texto de mob incompleto.");
        const id = buffer.readUInt32LE(cursor);
        const byteLength = buffer.readUInt16LE(cursor + 4) * 2;
        cursor += 6;
        if (cursor + byteLength > payloadEnd) throw new Error("Texto de mob ultrapassa a tabela.");
        text.set(id, buffer.toString("utf16le", cursor, cursor + byteLength));
        cursor += byteLength;
      }
      return text;
    }
    offset = payloadEnd;
  }
  throw new Error("A seção de nomes dos mobs não foi encontrada.");
}

function parseMob(buffer: Buffer, offset: number, names: Map<number, string>): MobCatalogEntry {
  const tblidx = buffer.readUInt32LE(offset);
  const nameTextId = buffer.readUInt32LE(offset + 64);
  const internalName = readFixedUtf16(buffer, offset + 68, 82);
  return {
    tblidx, valid: buffer.readUInt8(offset + 60) !== 0, nameTextId,
    name: names.get(nameTextId) || internalName || `Mob #${tblidx}`,
    internalName, modelName: readFixedString(buffer, offset + 150, 33),
    level: buffer.readUInt8(offset + 183), grade: buffer.readUInt8(offset + 184),
    mobType: buffer.readUInt8(offset + 464), mobKind: buffer.readUInt16LE(offset + 448),
    mobGroup: buffer.readUInt32LE(offset + 444), basicLp: buffer.readInt32LE(offset + 4),
    basicEp: buffer.readUInt16LE(offset + 8), physicalOffence: buffer.readUInt16LE(offset + 198),
    energyOffence: buffer.readUInt16LE(offset + 200), physicalDefence: buffer.readUInt16LE(offset + 10),
    energyDefence: buffer.readUInt16LE(offset + 12), attackRate: buffer.readUInt16LE(offset + 40),
    dodgeRate: buffer.readUInt16LE(offset + 42), blockRate: buffer.readUInt16LE(offset + 44),
    attackSpeedRate: buffer.readUInt16LE(offset + 32), attackRange: buffer.readFloatLE(offset + 36),
    sightRange: buffer.readUInt16LE(offset + 228), scanRange: buffer.readUInt16LE(offset + 230),
    walkSpeed: buffer.readFloatLE(offset + 208), runSpeed: buffer.readFloatLE(offset + 216),
    experience: buffer.readUInt32LE(offset + 460), dropZenny: buffer.readUInt32LE(offset + 452),
    dropZennyRate: buffer.readFloatLE(offset + 456), battleAttribute: buffer.readUInt8(offset + 197),
    allianceId: buffer.readUInt32LE(offset + 424), monsterClass: buffer.readUInt16LE(offset + 522),
    dragonBallDrop: buffer.readUInt8(offset + 520) !== 0, showName: buffer.readUInt8(offset + 510) !== 0,
  };
}

export function resolveMobCatalogPath() {
  return resolveServerTable("Table_MOB_Data.rdf", "MOB_TABLE_PATH");
}

function resolveTextPath() {
  return resolveServerTable("table_text_all_data.rdf", "MOB_TEXT_TABLE_PATH");
}

export async function loadMobCatalog() {
  const catalogPath = resolveMobCatalogPath();
  const textPath = resolveTextPath();
  const [fileStat, textStat] = await Promise.all([stat(/* turbopackIgnore: true */ catalogPath), stat(/* turbopackIgnore: true */ textPath)]);
  if (catalogCache?.path === catalogPath && catalogCache.modifiedAt === fileStat.mtimeMs && catalogCache.size === fileStat.size && catalogCache.textPath === textPath && catalogCache.textModifiedAt === textStat.mtimeMs && catalogCache.textSize === textStat.size) return catalogCache;
  const [buffer, textBuffer] = await Promise.all([readFile(/* turbopackIgnore: true */ catalogPath), readFile(/* turbopackIgnore: true */ textPath)]);
  if (buffer.length <= HEADER_SIZE || (buffer.length - HEADER_SIZE) % RECORD_SIZE !== 0) throw new Error(`Formato de Table_MOB_Data.rdf incompatível: ${buffer.length} bytes.`);
  const names = parseMobText(textBuffer);
  const mobs: MobCatalogEntry[] = [];
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += RECORD_SIZE) mobs.push(parseMob(buffer, offset, names));
  catalogCache = { path: catalogPath, modifiedAt: fileStat.mtimeMs, size: fileStat.size, textPath, textModifiedAt: textStat.mtimeMs, textSize: textStat.size, mobs };
  return catalogCache;
}
