import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import type { ActionCatalogEntry } from "@/lib/types";

/**
 * Table_Action_Data.rdf — as ações do jogador (emotes e comandos).
 *
 * Existe porque a árvore `action_skill.scr` não guarda TBLIDX de skill: guarda id de ação.
 * Resolver esses ids contra o catálogo de skills traria nome e ícone errados, ou nenhum.
 *
 * Layout de `sACTION_TBLDAT` (ActionTable.h) com `#pragma pack(4)`: 60 bytes, que dividem o
 * arquivo em 22 registros exatos. Os 22 nomes resolvem na seção 0 de table_text_all_data.
 */
const HEADER_SIZE = 1;
const RECORD_SIZE = 60;
const ACTION_TEXT_SECTION = 0;

const OFFSETS = { valid: 4, actionType: 5, nameTextId: 8, iconName: 12, noteTextId: 48, chatCommand: 52, etcType: 56 } as const;

/** eACTION_TYPE, em ActionTable.h. */
const ACTION_TYPE_LABELS: Record<number, string> = { 1: "Comando", 2: "Emote" };

type CatalogCache = {
  path: string; modifiedAt: number; size: number;
  textPath: string; textModifiedAt: number; textSize: number;
  actions: ActionCatalogEntry[];
  byTblidx: Map<number, ActionCatalogEntry>;
};

let catalogCache: CatalogCache | null = null;

function readFixedAscii(buffer: Buffer, offset: number, length: number) {
  const end = buffer.indexOf(0, offset);
  return buffer.toString("latin1", offset, end === -1 || end >= offset + length ? offset + length : end).trim();
}

/** Os textos de uma seção de table_text_all_data, no mesmo formato que o catálogo de mobs lê. */
function parseTextSection(buffer: Buffer, section: number) {
  const text = new Map<number, string>();
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const current = buffer.readInt32LE(offset);
    const payloadLength = buffer.readInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadLength < 1 || payloadEnd > buffer.length) break;
    if (current === section) {
      let cursor = payloadStart + 1;
      while (cursor < payloadEnd) {
        if (cursor + 6 > payloadEnd) break;
        const id = buffer.readUInt32LE(cursor);
        const byteLength = buffer.readUInt16LE(cursor + 4) * 2;
        cursor += 6;
        if (cursor + byteLength > payloadEnd) break;
        text.set(id, buffer.toString("utf16le", cursor, cursor + byteLength));
        cursor += byteLength;
      }
      return text;
    }
    offset = payloadEnd;
  }
  return text;
}

export function resolveActionCatalogPath() {
  return resolveServerTable("Table_Action_Data.rdf", "ACTION_TABLE_PATH");
}

function resolveActionTextPath() {
  return resolveServerTable("table_text_all_data.rdf", "ACTION_TEXT_TABLE_PATH");
}

export async function loadActionCatalog() {
  const catalogPath = resolveActionCatalogPath();
  const textPath = resolveActionTextPath();
  const [fileStat, textStat] = await Promise.all([
    stat(/* turbopackIgnore: true */ catalogPath),
    stat(/* turbopackIgnore: true */ textPath),
  ]);
  if (
    catalogCache?.path === catalogPath && catalogCache.modifiedAt === fileStat.mtimeMs && catalogCache.size === fileStat.size &&
    catalogCache.textPath === textPath && catalogCache.textModifiedAt === textStat.mtimeMs && catalogCache.textSize === textStat.size
  ) {
    return catalogCache;
  }

  const [buffer, textBuffer] = await Promise.all([
    readFile(/* turbopackIgnore: true */ catalogPath),
    readFile(/* turbopackIgnore: true */ textPath),
  ]);
  if (buffer.length <= HEADER_SIZE || (buffer.length - HEADER_SIZE) % RECORD_SIZE !== 0) {
    throw new Error(`Formato de Table_Action_Data.rdf incompatível: ${buffer.length} bytes.`);
  }

  const names = parseTextSection(textBuffer, ACTION_TEXT_SECTION);
  const actions: ActionCatalogEntry[] = [];
  const byTblidx = new Map<number, ActionCatalogEntry>();
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += RECORD_SIZE) {
    const nameTextId = buffer.readUInt32LE(offset + OFFSETS.nameTextId);
    const actionType = buffer.readUInt8(offset + OFFSETS.actionType);
    const entry: ActionCatalogEntry = {
      tblidx: buffer.readUInt32LE(offset),
      valid: buffer.readUInt8(offset + OFFSETS.valid) !== 0,
      actionType,
      actionTypeLabel: ACTION_TYPE_LABELS[actionType] ?? `Tipo ${actionType}`,
      nameTextId,
      name: names.get(nameTextId) || `Ação #${buffer.readUInt32LE(offset)}`,
      iconName: readFixedAscii(buffer, offset + OFFSETS.iconName, 33),
      chatCommand: buffer.readUInt32LE(offset + OFFSETS.chatCommand),
    };
    actions.push(entry);
    byTblidx.set(entry.tblidx, entry);
  }

  catalogCache = {
    path: catalogPath, modifiedAt: fileStat.mtimeMs, size: fileStat.size,
    textPath, textModifiedAt: textStat.mtimeMs, textSize: textStat.size,
    actions, byTblidx,
  };
  return catalogCache;
}
