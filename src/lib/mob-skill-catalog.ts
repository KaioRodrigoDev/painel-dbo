import "server-only";

import { loadMobCatalog } from "@/lib/mob-catalog";
import { loadSkillCatalog } from "@/lib/skill-catalog";
import type { MobSkillSlot, MobSkillValues } from "@/lib/types";

/**
 * As skills que um mob usa.
 *
 * Não existe tabela separada: ficam no próprio registro do mob, em quatro arrays paralelos
 * de 7 posições herdados de `sBOT_TBLDAT` (NPCTable.h). O GameServer percorre esses arrays
 * em `CNpc::LoadSkillTable` (Npc.cpp) e monta uma condição de uso por posição preenchida.
 *
 * Os offsets abaixo saem do layout da struct com `#pragma pack(4)` e foram conferidos de
 * duas formas: a soma dos campos fecha exatamente os 584 bytes do registro, e os 32 offsets
 * que o catálogo de mobs já usava batem todos. Na tabela de verdade, as 4.380 referências de
 * skill existentes apontam todas para skills reais, e `byUse_Skill_Basis` só aparece com os
 * valores 3 a 7 -- exatamente os que o servidor aceita.
 */
export const MOB_SKILL_OFFSETS = {
  time: 232,   // WORD[7]
  tblidx: 248, // TBLIDX[7]
  basis: 276,  // BYTE[7]
  lp: 284,     // WORD[7]
} as const;

export const MAX_MOB_SKILLS = 7;
export const INVALID_SKILL_TBLIDX = 0xffffffff;
const INVALID_BYTE = 0xff;
const INVALID_WORD = 0xffff;

/**
 * `byUse_Skill_Basis` escolhe a classe de condição em `CSkillManagerBot::AddSkill`.
 *
 * Fora de 3..7 o servidor registra erro no log e **descarta a skill** -- o mob simplesmente
 * não a usa. Por isso o editor trata essa faixa como fechada em vez de campo livre.
 */
export const SKILL_BASIS = [
  { value: 3, label: "LP abaixo de", condition: "CSkillCondition_LP", lpMeaning: "percent", note: "Dispara quando a vida do mob cai abaixo da porcentagem indicada." },
  { value: 4, label: "Ao receber dano", condition: "CSkillCondition_Give", lpMeaning: "percent", note: "Reage ao dano recebido." },
  { value: 5, label: "Por tempo", condition: "CSkillCondition_Time", lpMeaning: "unused", note: "O uso mais comum: repete no intervalo definido." },
  { value: 6, label: "Distância do alvo", condition: "CSkillCondition_RingRange", lpMeaning: "range", note: "Aqui o campo de LP vale como alcance, não como vida." },
  { value: 7, label: "Somente LP", condition: "CSkillCondition_OnlyLP", lpMeaning: "percent", note: "Só olha a vida, sem o intervalo de tempo." },
] as const;

export function basisLabel(value: number) {
  return SKILL_BASIS.find((entry) => entry.value === value)?.label ?? `Condição ${value}`;
}

export function basisLpMeaning(value: number) {
  return SKILL_BASIS.find((entry) => entry.value === value)?.lpMeaning ?? "percent";
}

/** As posições preenchidas do registro, na ordem em que estão no arquivo. */
export function readMobSkillValues(buffer: Buffer, recordOffset: number): MobSkillValues {
  const slots: MobSkillValues["slots"] = [];
  for (let index = 0; index < MAX_MOB_SKILLS; index += 1) {
    const tblidx = buffer.readUInt32LE(recordOffset + MOB_SKILL_OFFSETS.tblidx + index * 4);
    if (tblidx === INVALID_SKILL_TBLIDX || tblidx === 0) continue;
    slots.push({
      tblidx,
      basis: buffer.readUInt8(recordOffset + MOB_SKILL_OFFSETS.basis + index),
      lp: buffer.readUInt16LE(recordOffset + MOB_SKILL_OFFSETS.lp + index * 2),
      time: buffer.readUInt16LE(recordOffset + MOB_SKILL_OFFSETS.time + index * 2),
    });
  }
  return { slots };
}

/**
 * Grava as 7 posições, compactadas.
 *
 * As preenchidas vão para o começo. O resto recebe os mesmos marcadores que o arquivo
 * original usa -- `INVALID_TBLIDX`, `INVALID_BYTE`, `INVALID_WORD` -- e não zeros. Só o
 * tblidx é testado pelo servidor, então os outros três não mudariam o comportamento; a
 * questão é não deixar a tabela com uma convenção diferente da que o jogo escreveu, que
 * confundiria qualquer outra ferramenta que a leia.
 *
 * Compactar é seguro: `AddSkill` recebe o índice da posição mas não o usa; o índice da
 * condição vem de um contador próprio.
 */
export function writeMobSkillValues(buffer: Buffer, recordOffset: number, values: MobSkillValues) {
  if (values.slots.length > MAX_MOB_SKILLS) throw new Error(`Um mob aceita no máximo ${MAX_MOB_SKILLS} skills.`);
  for (let index = 0; index < MAX_MOB_SKILLS; index += 1) {
    const slot = values.slots[index];
    buffer.writeUInt32LE(slot?.tblidx ?? INVALID_SKILL_TBLIDX, recordOffset + MOB_SKILL_OFFSETS.tblidx + index * 4);
    buffer.writeUInt8(slot?.basis ?? INVALID_BYTE, recordOffset + MOB_SKILL_OFFSETS.basis + index);
    buffer.writeUInt16LE(slot?.lp ?? INVALID_WORD, recordOffset + MOB_SKILL_OFFSETS.lp + index * 2);
    buffer.writeUInt16LE(slot?.time ?? INVALID_WORD, recordOffset + MOB_SKILL_OFFSETS.time + index * 2);
  }
}

/** As skills de um mob com nome e ícone resolvidos, para a tela. */
export async function resolveMobSkills(mobTblidx: number) {
  const [mobCatalog, skillCatalog] = await Promise.all([loadMobCatalog(), loadSkillCatalog()]);
  const mob = mobCatalog.mobs.find((candidate) => candidate.tblidx === mobTblidx);
  if (!mob) return null;

  const recordOffset = mobCatalog.offsetByTblidx.get(mob.tblidx);
  if (recordOffset === undefined) return null;
  const values = readMobSkillValues(mobCatalog.buffer, recordOffset);
  const slots: MobSkillSlot[] = values.slots.map((slot, index) => {
    const skill = skillCatalog.skills.find((entry) => entry.tblidx === slot.tblidx);
    return {
      slot: index,
      tblidx: slot.tblidx,
      name: skill?.name ?? `Skill #${slot.tblidx}`,
      iconName: skill?.iconName ?? "",
      requiredEp: skill?.requiredEp ?? 0,
      basis: slot.basis,
      lp: slot.lp,
      time: slot.time,
      missing: !skill,
    };
  });

  return {
    mob: { tblidx: mob.tblidx, name: mob.name, level: mob.level, grade: mob.grade, mobType: mob.mobType },
    slots,
    values,
  };
}
