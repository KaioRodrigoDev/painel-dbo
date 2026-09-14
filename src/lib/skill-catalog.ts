import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveServerTable } from "@/lib/game-paths";
import type { SkillCatalogEntry } from "@/lib/types";

export const SKILL_RDF_HEADER_SIZE = 1;
export const SKILL_RDF_RECORD_SIZE = 348;
const SKILL_TEXT_SECTION = 7;
const EFFECT_COUNT = 2;
const RP_EFFECT_COUNT = 6;

type CatalogCache = {
  path: string;
  modifiedAt: number;
  size: number;
  textPath: string;
  textModifiedAt: number;
  textSize: number;
  skills: SkillCatalogEntry[];
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

function parseSkill(buffer: Buffer, offset: number, localizedText: Map<number, string>): SkillCatalogEntry {
  const tblidx = buffer.readUInt32LE(offset);
  const nameTextId = buffer.readUInt32LE(offset + 4);
  const noteTextId = buffer.readUInt32LE(offset + 300);
  const internalName = readFixedUtf16(buffer, offset + 8, 82);

  return {
    tblidx,
    valid: buffer.readUInt8(offset + 90) !== 0,
    nameTextId,
    noteTextId,
    name: localizedText.get(nameTextId) || internalName || `Skill #${tblidx}`,
    description: localizedText.get(noteTextId) || "",
    internalName,
    iconName: readFixedString(buffer, offset + 218, 33),
    classFlag: buffer.readUInt32LE(offset + 92),
    classType: buffer.readUInt8(offset + 96),
    skillClass: buffer.readUInt8(offset + 97),
    skillType: buffer.readUInt8(offset + 98),
    activeType: buffer.readUInt8(offset + 99),
    buffGroup: buffer.readUInt8(offset + 100),
    slotIndex: buffer.readUInt8(offset + 101),
    grade: buffer.readUInt8(offset + 102),
    functionFlag: buffer.readUInt32LE(offset + 104),
    appointTarget: buffer.readUInt8(offset + 108),
    applyTarget: buffer.readUInt8(offset + 109),
    applyTargetMax: buffer.readUInt8(offset + 110),
    applyRange: buffer.readUInt8(offset + 111),
    applyAreaSize1: buffer.readUInt8(offset + 112),
    applyAreaSize2: buffer.readUInt8(offset + 113),
    effectIds: Array.from({ length: EFFECT_COUNT }, (_, index) => buffer.readUInt32LE(offset + 116 + index * 4)),
    effectTypes: Array.from({ length: EFFECT_COUNT }, (_, index) => buffer.readUInt8(offset + 124 + index)),
    effectValues: Array.from({ length: EFFECT_COUNT }, (_, index) => buffer.readDoubleLE(offset + 128 + index * 8)),
    additionalAggro: buffer.readUInt32LE(offset + 144),
    rpEffects: Array.from({ length: RP_EFFECT_COUNT }, (_, index) => buffer.readUInt8(offset + 148 + index)),
    rpEffectValues: Array.from({ length: RP_EFFECT_COUNT }, (_, index) => buffer.readFloatLE(offset + 156 + index * 4)),
    requiredLevel: buffer.readUInt8(offset + 180),
    requiredZenny: buffer.readUInt32LE(offset + 184),
    requiredSp: buffer.readUInt16LE(offset + 190),
    selfTrain: buffer.readUInt8(offset + 192) !== 0,
    prerequisiteSkillIds: [196, 200, 204, 208].map((fieldOffset) => buffer.readUInt32LE(offset + fieldOffset)),
    rootSkillId: buffer.readUInt32LE(offset + 212),
    requiredEquipSlotType: buffer.readUInt8(offset + 216),
    requiredItemType: buffer.readUInt8(offset + 217),
    requiredLp: buffer.readUInt32LE(offset + 252),
    requiredEp: buffer.readUInt16LE(offset + 256),
    requiredRpBalls: buffer.readUInt8(offset + 258),
    castingTimeMs: buffer.readUInt32LE(offset + 264),
    cooldownMs: buffer.readUInt32LE(offset + 272),
    keepTimeMs: buffer.readUInt32LE(offset + 280),
    keepEffect: buffer.readUInt8(offset + 284) !== 0,
    useRangeMin: buffer.readFloatLE(offset + 288),
    useRangeMax: buffer.readFloatLE(offset + 296),
    nextSkillId: buffer.readUInt32LE(offset + 304),
    defaultDisplayOff: buffer.readUInt8(offset + 308) !== 0,
    animationTimeMs: buffer.readUInt32LE(offset + 312),
    castingAnimationStart: buffer.readUInt16LE(offset + 316),
    castingAnimationLoop: buffer.readUInt16LE(offset + 318),
    actionAnimation: buffer.readUInt16LE(offset + 320),
    actionLoopAnimation: buffer.readUInt16LE(offset + 322),
    actionEndAnimation: buffer.readUInt16LE(offset + 324),
    dashAble: buffer.readUInt8(offset + 326) !== 0,
    successRate: buffer.readFloatLE(offset + 332),
    classChange: buffer.readUInt8(offset + 336),
    useType: buffer.readUInt8(offset + 337),
    skillGroup: buffer.readUInt8(offset + 338),
    requiredVp: buffer.readUInt32LE(offset + 340),
    restrictionRuleFlag: buffer.readUInt32LE(offset + 344),
  };
}

function parseSkillText(buffer: Buffer) {
  const text = new Map<number, string>();
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const section = buffer.readInt32LE(offset);
    const payloadLength = buffer.readInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadLength < 1 || payloadEnd > buffer.length) {
      throw new Error("Formato de table_text_all_data.rdf incompatível.");
    }

    if (section === SKILL_TEXT_SECTION) {
      let textOffset = payloadStart + 1;
      while (textOffset < payloadEnd) {
        if (textOffset + 6 > payloadEnd) throw new Error("Registro de texto de skill incompleto.");
        const textId = buffer.readUInt32LE(textOffset);
        const textLength = buffer.readUInt16LE(textOffset + 4);
        const byteLength = textLength * 2;
        textOffset += 6;
        if (textOffset + byteLength > payloadEnd) throw new Error("Texto de skill ultrapassa o tamanho da tabela.");
        text.set(textId, buffer.toString("utf16le", textOffset, textOffset + byteLength));
        textOffset += byteLength;
      }
      return text;
    }
    offset = payloadEnd;
  }

  throw new Error("A seção de textos das skills não foi encontrada.");
}

export function resolveSkillCatalogPath() {
  return resolveServerTable("Table_Skill_Data.rdf", "SKILL_TABLE_PATH");
}

export function resolveSkillTextCatalogPath() {
  return resolveServerTable("table_text_all_data.rdf", "SKILL_TEXT_TABLE_PATH");
}

export async function loadSkillCatalog() {
  const catalogPath = resolveSkillCatalogPath();
  const textPath = resolveSkillTextCatalogPath();
  const fileStat = await stat(/* turbopackIgnore: true */ catalogPath);
  const textStat = await stat(/* turbopackIgnore: true */ textPath);
  if (catalogCache?.path === catalogPath && catalogCache.modifiedAt === fileStat.mtimeMs && catalogCache.size === fileStat.size && catalogCache.textPath === textPath && catalogCache.textModifiedAt === textStat.mtimeMs && catalogCache.textSize === textStat.size) return catalogCache;

  const buffer = await readFile(/* turbopackIgnore: true */ catalogPath);
  const textBuffer = await readFile(/* turbopackIgnore: true */ textPath);
  if (buffer.length <= SKILL_RDF_HEADER_SIZE || (buffer.length - SKILL_RDF_HEADER_SIZE) % SKILL_RDF_RECORD_SIZE !== 0) {
    throw new Error(`Formato de Table_Skill_Data.rdf incompatível: ${buffer.length} bytes.`);
  }

  const localizedText = parseSkillText(textBuffer);
  const skills: SkillCatalogEntry[] = [];
  for (let offset = SKILL_RDF_HEADER_SIZE; offset < buffer.length; offset += SKILL_RDF_RECORD_SIZE) skills.push(parseSkill(buffer, offset, localizedText));

  catalogCache = { path: catalogPath, modifiedAt: fileStat.mtimeMs, size: fileStat.size, textPath, textModifiedAt: textStat.mtimeMs, textSize: textStat.size, skills };
  return catalogCache;
}

export function invalidateSkillCatalogCache() {
  catalogCache = null;
}
