import "server-only";

import { readFile, stat } from "node:fs/promises";
import { resolveUseItemCatalogPath } from "@/lib/gamble-catalog";
import { resolveServerTable } from "@/lib/game-paths";
import { parseTextSection, resolveItemTextCatalogPath, TEXT_SECTION } from "@/lib/item-catalog";
import { loadSystemEffectCatalog } from "@/lib/system-effect-catalog";
import type { ItemCatalogEntry, ItemEffects, SystemEffectEntry } from "@/lib/types";

/**
 * Os efeitos que o tooltip do item mostra no jogo.
 *
 * O Table_Item_Data só aponta para eles. O caminho, igual ao do cliente
 * (CInfoWindowGui::SetItemInfo_ItemOption e Logic_GetSystemEffectText):
 *
 *   item.Item_Option_Tblidx -> table_item_option_data.rdf -> até 4 system_Effect + nValue
 *   item.Use_Item_Tblidx    -> Table_Use_Item_Data.rdf    -> até 2 aSystem_Effect + valor
 *   system effect           -> Table_System_Effect_Data   -> Effect_Info_Text
 *   Effect_Info_Text        -> seção SYSTEM_EFFECT da tabela de textos ("Increases Max LP by %d")
 *
 * Ex.: o chip de scouter 533001 tem a opção 533001 = efeito 603 (ACTIVE_MAX_LP_UP) valor 30,
 * e o jogo mostra "Increases Max LP by 30".
 */

const HEADER_SIZE = 1;
const INVALID_TBLIDX = 0xffffffff;
/** eSKILL_ACTIVE_TYPE::SKILL_ACTIVE_TYPE_DOT: o cliente não põe "%" nesses. */
const ACTIVE_TYPE_DOT = 1;

/** sITEM_OPTION_TBLDAT (ItemOptionTable.h), #pragma pack(4). */
const OPTION_RECORD_SIZE = 260;
const OPTION_OFFSETS = { name: 4, nameBytes: 62, systemEffect: 80, appliedInPercent: 96, value: 100 } as const;
const OPTION_EFFECT_COUNT = 4;

/** sUSE_ITEM_TBLDAT (UseItemTable.h), #pragma pack(4); o mesmo tamanho do gamble-catalog. */
const USE_ITEM_RECORD_SIZE = 220;
const USE_ITEM_OFFSETS = { systemEffect: 40, effectType: 48, value: 52, coolTime: 84, keepTime: 92 } as const;
const USE_ITEM_EFFECT_COUNT = 2;

type RawEffect = { tblidx: number; percent: boolean; value: number };
type OptionRecord = { name: string; effects: RawEffect[] };
type UseRecord = { effects: RawEffect[]; cooldownSeconds: number; durationSeconds: number };

type EffectsCache = {
  key: string;
  options: Map<number, OptionRecord>;
  uses: Map<number, UseRecord>;
  texts: Map<number, string>;
};

let effectsCache: EffectsCache | null = null;

export function resolveItemOptionCatalogPath() {
  return resolveServerTable("table_item_option_data.rdf", "ITEM_OPTION_TABLE_PATH");
}

function readFixedUtf16(buffer: Buffer, offset: number, byteLength: number) {
  let end = offset;
  while (end + 1 < offset + byteLength && buffer.readUInt16LE(end) !== 0) end += 2;
  return buffer.toString("utf16le", offset, end).trim();
}

function checkSize(buffer: Buffer, recordSize: number, file: string) {
  if (buffer.length <= HEADER_SIZE || (buffer.length - HEADER_SIZE) % recordSize !== 0) {
    throw new Error(`Formato de ${file} incompatível: ${buffer.length} bytes.`);
  }
}

function parseOptions(buffer: Buffer) {
  checkSize(buffer, OPTION_RECORD_SIZE, "table_item_option_data.rdf");
  const options = new Map<number, OptionRecord>();
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += OPTION_RECORD_SIZE) {
    const effects: RawEffect[] = [];
    for (let index = 0; index < OPTION_EFFECT_COUNT; index++) {
      const tblidx = buffer.readUInt32LE(offset + OPTION_OFFSETS.systemEffect + index * 4);
      if (tblidx === INVALID_TBLIDX) continue;
      effects.push({
        tblidx,
        percent: buffer.readUInt8(offset + OPTION_OFFSETS.appliedInPercent + index) !== 0,
        value: buffer.readInt32LE(offset + OPTION_OFFSETS.value + index * 4),
      });
    }
    options.set(buffer.readUInt32LE(offset), {
      name: readFixedUtf16(buffer, offset + OPTION_OFFSETS.name, OPTION_OFFSETS.nameBytes),
      effects,
    });
  }
  return options;
}

function parseUses(buffer: Buffer) {
  checkSize(buffer, USE_ITEM_RECORD_SIZE, "Table_Use_Item_Data.rdf");
  const uses = new Map<number, UseRecord>();
  for (let offset = HEADER_SIZE; offset < buffer.length; offset += USE_ITEM_RECORD_SIZE) {
    const effects: RawEffect[] = [];
    for (let index = 0; index < USE_ITEM_EFFECT_COUNT; index++) {
      const tblidx = buffer.readUInt32LE(offset + USE_ITEM_OFFSETS.systemEffect + index * 4);
      if (tblidx === INVALID_TBLIDX) continue;
      effects.push({
        tblidx,
        percent: buffer.readUInt8(offset + USE_ITEM_OFFSETS.effectType + index) !== 0,
        value: buffer.readDoubleLE(offset + USE_ITEM_OFFSETS.value + index * 8),
      });
    }
    uses.set(buffer.readUInt32LE(offset), {
      effects,
      cooldownSeconds: buffer.readUInt32LE(offset + USE_ITEM_OFFSETS.coolTime),
      durationSeconds: buffer.readUInt32LE(offset + USE_ITEM_OFFSETS.keepTime),
    });
  }
  return uses;
}

async function loadEffectTables() {
  const paths = [resolveItemOptionCatalogPath(), resolveUseItemCatalogPath(), resolveItemTextCatalogPath()];
  const stats = await Promise.all(paths.map((file) => stat(/* turbopackIgnore: true */ file)));
  const key = paths.map((file, index) => `${file}:${stats[index].mtimeMs}:${stats[index].size}`).join("|");
  if (effectsCache?.key === key) return effectsCache;

  const [optionBuffer, useBuffer, textBuffer] = await Promise.all(paths.map((file) => readFile(/* turbopackIgnore: true */ file)));
  effectsCache = {
    key,
    options: parseOptions(optionBuffer),
    uses: parseUses(useBuffer),
    texts: parseTextSection(textBuffer, TEXT_SECTION.systemEffect),
  };
  return effectsCache;
}

function formatValue(value: number, integer: boolean) {
  if (integer) return String(Math.trunc(value));
  return String(Math.round(value * 100) / 100);
}

/**
 * Monta a linha como Logic_GetSystemEffectText: o texto tem um %d (inteiro) ou %g (decimal), e
 * o "%" de porcentagem entra logo depois do número.
 */
function describeEffect(effect: RawEffect, systemEffects: Map<number, SystemEffectEntry>, texts: Map<number, string>) {
  const systemEffect = systemEffects.get(effect.tblidx);
  if (!systemEffect) return `Efeito ${effect.tblidx} (não está na Table_System_Effect_Data): ${formatValue(effect.value, false)}`;

  const percent = effect.percent && systemEffect.activeEffectType !== ACTIVE_TYPE_DOT ? "%" : "";
  const template = texts.get(systemEffect.infoTextId)?.replaceAll("%%", "%");
  if (!template) return `${systemEffect.name}: ${formatValue(effect.value, false)}${percent}`;

  const intAt = template.indexOf("%d");
  const at = intAt >= 0 ? intAt : template.indexOf("%g");
  if (at < 0) return template;
  return `${template.slice(0, at)}${formatValue(effect.value, intAt >= 0)}${percent}${template.slice(at + 2)}`;
}

/** Os efeitos de cada item da lista, pelo TBLIDX; item sem opção nem uso fica com os dois nulos. */
export async function describeItemEffects(items: ItemCatalogEntry[]) {
  const [tables, systemEffects] = await Promise.all([loadEffectTables(), loadSystemEffectCatalog()]);
  const result = new Map<number, ItemEffects>();

  for (const item of items) {
    const option = item.itemOptionTblidx !== INVALID_TBLIDX ? tables.options.get(item.itemOptionTblidx) : undefined;
    const use = item.useItemTblidx !== INVALID_TBLIDX ? tables.uses.get(item.useItemTblidx) : undefined;
    result.set(item.tblidx, {
      option: option && option.effects.length > 0 ? {
        tblidx: item.itemOptionTblidx,
        name: option.name,
        lines: option.effects.map((effect) => describeEffect(effect, systemEffects.byTblidx, tables.texts)),
      } : null,
      use: use && use.effects.length > 0 ? {
        tblidx: item.useItemTblidx,
        lines: use.effects.map((effect) => describeEffect(effect, systemEffects.byTblidx, tables.texts)),
        cooldownSeconds: use.cooldownSeconds,
        durationSeconds: use.durationSeconds,
      } : null,
    });
  }
  return result;
}
