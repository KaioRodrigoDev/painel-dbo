import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import type { SystemEffectEntry } from "@/lib/types";

/**
 * Table_System_Effect_Data.rdf — o que `skill_Effect[2]` aponta.
 *
 * Existe só para o editor de skills parar de pedir um TBLIDX cru no campo de efeito. Os
 * nomes na tabela já são descritivos (`PASSIVE_MAX_LP_UP`, `ACTIVE_PHYSICAL_DAMAGE`...),
 * então dá para escolher pelo nome sem precisar de tradução.
 *
 * Layout de `sSYSTEM_EFFECT_TBLDAT` (SystemEffectTable.h) com `#pragma pack(4)`; o total de
 * 172 bytes divide o arquivo em 362 registros exatos, e o primeiro deles bate com o enum
 * `eSYSTEM_EFFECT_CODE` começando em zero.
 */
const HEADER_SIZE = 1;
const RECORD_SIZE = 172;

const OFFSETS = {
  name: 4,            // WCHAR[41]
  effectType: 86,     // BYTE
  activeEffectType: 87,
  infoTextId: 88,     // TBLIDX
  successEffect: 97,  // char[33]
  effectCode: 168,    // eSYSTEM_EFFECT_CODE
} as const;

type CatalogCache = {
  path: string; modifiedAt: number; size: number;
  effects: SystemEffectEntry[];
  byTblidx: Map<number, SystemEffectEntry>;
};

let catalogCache: CatalogCache | null = null;

function readFixedUtf16(buffer: Buffer, offset: number, byteLength: number) {
  let end = offset;
  while (end + 1 < offset + byteLength && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end).trim();
}

function readFixedAscii(buffer: Buffer, offset: number, length: number) {
  const end = buffer.indexOf(0, offset);
  return buffer.toString("latin1", offset, end === -1 || end >= offset + length ? offset + length : end).trim();
}

export function resolveSystemEffectCatalogPath() {
  return resolveServerTable("Table_System_Effect_Data.rdf", "SYSTEM_EFFECT_TABLE_PATH");
}

export async function loadSystemEffectCatalog() {
  const catalogPath = resolveSystemEffectCatalogPath();
  const fileStat = await stat(/* turbopackIgnore: true */ catalogPath);
  if (catalogCache?.path === catalogPath && catalogCache.modifiedAt === fileStat.mtimeMs && catalogCache.size === fileStat.size) {
    return catalogCache;
  }

  const buffer = await readFile(/* turbopackIgnore: true */ catalogPath);
  if (buffer.length <= HEADER_SIZE || (buffer.length - HEADER_SIZE) % RECORD_SIZE !== 0) {
    throw new Error(`Formato de Table_System_Effect_Data.rdf incompatível: ${buffer.length} bytes.`);
  }

  const effects: SystemEffectEntry[] = [];
  const byTblidx = new Map<number, SystemEffectEntry>();
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += RECORD_SIZE) {
    const entry: SystemEffectEntry = {
      tblidx: buffer.readUInt32LE(offset),
      name: readFixedUtf16(buffer, offset + OFFSETS.name, 82),
      effectType: buffer.readUInt8(offset + OFFSETS.effectType),
      activeEffectType: buffer.readUInt8(offset + OFFSETS.activeEffectType),
      effectCode: buffer.readUInt32LE(offset + OFFSETS.effectCode),
      successEffectName: readFixedAscii(buffer, offset + OFFSETS.successEffect, 33),
    };
    effects.push(entry);
    byTblidx.set(entry.tblidx, entry);
  }

  catalogCache = { path: catalogPath, modifiedAt: fileStat.mtimeMs, size: fileStat.size, effects, byTblidx };
  return catalogCache;
}

export async function findSystemEffect(tblidx: number) {
  return (await loadSystemEffectCatalog()).byTblidx.get(tblidx) ?? null;
}
