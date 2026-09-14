import type { SkillCatalogEntry, SkillDraftValue } from "@/lib/types";
import { ITEM_TYPE_CREATION_DEFINITIONS } from "@/lib/item-creation-definitions";

export type SkillCreationGroup = "identity" | "classification" | "targeting" | "effects" | "requirements" | "timing" | "progression" | "animation" | "advanced";
export type SkillCreationControl = "text" | "number" | "checkbox" | "select" | "bitflag" | "reference" | "number-list";
export type SkillCreationFieldId =
  | "tblidx" | "name" | "description" | "internalName" | "iconName" | "valid"
  | "classFlag" | "classType" | "skillClass" | "skillType" | "activeType" | "buffGroup" | "slotIndex" | "grade" | "skillGroup" | "functionFlag"
  | "appointTarget" | "applyTarget" | "applyTargetMax" | "applyRange" | "applyAreaSize1" | "applyAreaSize2"
  | "effectIds" | "effectTypes" | "effectValues" | "additionalAggro" | "rpEffects" | "rpEffectValues" | "successRate"
  | "requiredLevel" | "requiredZenny" | "requiredSp" | "selfTrain" | "prerequisiteSkillIds" | "rootSkillId" | "requiredEquipSlotType" | "requiredItemType" | "requiredLp" | "requiredEp" | "requiredRpBalls" | "requiredVp"
  | "castingTimeMs" | "cooldownMs" | "keepTimeMs" | "keepEffect" | "useRangeMin" | "useRangeMax"
  | "nextSkillId" | "defaultDisplayOff"
  | "animationTimeMs" | "castingAnimationStart" | "castingAnimationLoop" | "actionAnimation" | "actionLoopAnimation" | "actionEndAnimation" | "dashAble"
  | "classChange" | "useType" | "restrictionRuleFlag";

export type SkillCreationField = {
  id: SkillCreationFieldId;
  label: string;
  sourceField: string;
  control: SkillCreationControl;
  group: SkillCreationGroup;
  required?: boolean;
  locked?: boolean;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  options?: Array<{ value: number; label: string }>;
};

const field = (id: SkillCreationFieldId, label: string, sourceField: string, control: SkillCreationControl, group: SkillCreationGroup, extra: Omit<SkillCreationField, "id" | "label" | "sourceField" | "control" | "group"> = {}): SkillCreationField => ({ id, label, sourceField, control, group, ...extra });
const byte = { min: 0, max: 255 };
const word = { min: 0, max: 65535 };
const dword = { min: 0, max: 4294967295 };

const SKILL_CLASS_OPTIONS = [{ value: 0, label: "Passiva" }, { value: 1, label: "Ativa" }, { value: 2, label: "HTB" }];
const SKILL_TYPE_OPTIONS = [{ value: 0, label: "Sem tipo" }, { value: 1, label: "Física" }, { value: 2, label: "Energia" }, { value: 3, label: "Estado" }, { value: 4, label: "Customizado 4" }];
const ACTIVE_TYPE_OPTIONS = ["Dano direto", "Dano periódico", "Cura direta", "Cura periódica", "Bênção direta", "Buff", "Maldição direta", "Debuff"].map((label, value) => ({ value, label }));
const APPOINT_TARGET_OPTIONS = [{ value: 0, label: "Próprio" }, { value: 1, label: "Alvo selecionado" }, { value: 2, label: "Ponto no mapa" }, { value: 255, label: "Desconhecido" }];
const APPLY_TARGET_OPTIONS = ["Próprio", "Inimigo", "Aliança", "Grupo", "Grupo de mobs", "Qualquer", "Invocação", "Qualquer NPC", "Qualquer mob", "Qualquer aliança"].map((label, value) => ({ value, label }));
const APPLY_RANGE_OPTIONS = ["Alvo único", "Círculo", "Retângulo", "Linha frontal", "Frontal flexível", "Anel", "Cone/leque"].map((label, value) => ({ value, label }));
const CHARACTER_CLASS_OPTIONS = ["Lutador humano", "Místico humano", "Engenheiro humano", "Guerreiro Namek", "Místico Namek", "Mighty Majin", "Wonder Majin", "Street Fighter", "Sword Master", "Crane Roshi", "Turtle Roshi", "Gun Mania", "Mech Mania", "Dark Warrior", "Shadow Knight", "Dende Priest", "Poko Priest", "Ultimate Majin", "Grand Chef Majin", "Plasma Majin", "Karma Majin"].map((label, value) => ({ value, label }));
const EQUIP_SLOT_OPTIONS = ["Mão/arma principal", "Arma secundária", "Jaqueta", "Calça", "Botas", "Scouter", "Missão", "Colar", "Brinco 1", "Brinco 2", "Anel 1", "Anel 2", "Conjunto de costume", "Cabelo de costume", "Máscara de costume", "Acessório de cabelo", "Acessório das costas"].map((label, value) => ({ value, label }));
const REQUIRED_ITEM_OPTIONS = [{ value: 255, label: "Nenhum tipo específico" }, ...ITEM_TYPE_CREATION_DEFINITIONS.map((item) => ({ value: item.value, label: item.label }))];

/**
 * bySkill_Effect_Type[2] guarda um eSYSTEM_EFFECT_APPLY_TYPE (NtlBattle.h:272), que diz COMO
 * aSkill_Effect_Value deve ser lido: absoluto, percentual ou fração de um atributo.
 * battle.cpp:125 e :414 comparam justamente com VALUE e PERCENT.
 * Na base atual só aparecem 0, 1, 2 e 255; os demais existem no enum e ficam disponíveis.
 */
export const SYSTEM_EFFECT_APPLY_TYPE_OPTIONS = [
  { value: 0, label: "Valor absoluto" }, { value: 1, label: "Percentual" },
  { value: 2, label: "% do LP máximo" }, { value: 3, label: "% do EP máximo" }, { value: 4, label: "% do RP máximo" },
  { value: 5, label: "% do LP atual" }, { value: 6, label: "% do EP atual" }, { value: 7, label: "% do RP atual" },
  { value: 8, label: "% do ataque físico" }, { value: 9, label: "% do ataque de energia" },
  { value: 10, label: "% da defesa física" }, { value: 11, label: "% da defesa de energia" },
  { value: 12, label: "% do SP máximo do mascote" }, { value: 255, label: "Sem efeito" },
];

/**
 * abyRpEffect[6] NAO e uma lista livre: cada posicao e um slot fixo (eDBO_RP_BONUS_SLOT) e
 * guarda o codigo eDBO_RP_BONUS_TYPE daquele slot, ou 255 para desligado.
 *
 * O servidor confirma: Skill.cpp e SkillManagerPc.cpp leem afRpEffectValue por indice fixo
 * (DBO_RP_BONUS_SLOT_RESULT_PLUS, _COOL_TIME_MINUS, ...) sem consultar abyRpEffect. Só o
 * cliente (NtlSobSkillIcon.cpp:432) e SkillPc.cpp:468 procuram pelo tipo. Trocar a ordem
 * quebra o servidor em silencio, por isso o slot e fixo aqui e o editor nao deixa reordenar.
 *
 * Confirmado nos dados: das 1239 skills com RP, a posicao 0 so contem 1 ou 255, a 1 so 2 ou
 * 255, a 2 so 5 ou 255, a 3 so 4 ou 255 e a 5 so 6 ou 255. A posicao 4 e a unica com escolha
 * (3 = duracao ou 0 = knockdown), o que explica a colisao do enum em NtlSkill.h:150-151.
 */
export type RpBonusSlot = { index: number; label: string; unit: string; help: string; options: Array<{ value: number; label: string }> };
const RP_OFF = { value: 255, label: "Desligado" };
export const RP_BONUS_SLOTS: RpBonusSlot[] = [
  { index: 0, label: "Aumentar dano/resultado", unit: "absoluto", help: "Somado ao dano ou ao valor do efeito.", options: [RP_OFF, { value: 1, label: "Aumentar dano/resultado" }] },
  { index: 1, label: "Reduzir custo de EP", unit: "%", help: "Percentual, conforme o comentário do enum.", options: [RP_OFF, { value: 2, label: "Reduzir custo de EP" }] },
  { index: 2, label: "Reduzir cooldown", unit: "segundos", help: "O servidor multiplica por 1000 (SkillManagerPc.cpp:210).", options: [RP_OFF, { value: 5, label: "Reduzir cooldown" }] },
  { index: 3, label: "Reduzir casting", unit: "segundos", help: "O servidor multiplica por 1000 (Skill.cpp:221).", options: [RP_OFF, { value: 4, label: "Reduzir casting" }] },
  { index: 4, label: "Duração ou knockdown", unit: "segundos / chance", help: "Único slot com duas opções; em segundos quando for duração (Skill.cpp:1776).", options: [RP_OFF, { value: 3, label: "Aumentar duração" }, { value: 0, label: "Chance de knockdown" }] },
  { index: 5, label: "Quebrar guarda", unit: "valor", help: "Na base atual o valor usado é 250.", options: [RP_OFF, { value: 6, label: "Quebrar guarda" }] },
];

export const SKILL_CREATION_FIELDS: Record<SkillCreationFieldId, SkillCreationField> = {
  tblidx: field("tblidx", "Novo TBLIDX", "tblidx", "number", "identity", { required: true, min: 1, max: 4294967294, help: "Identificador único no Table_Skill_Data." }),
  name: field("name", "Nome exibido", "Skill_Name + SKILL_DATA text", "text", "identity", { required: true }),
  description: field("description", "Descrição", "Note + SKILL_DATA text", "text", "identity"),
  internalName: field("internalName", "Nome interno", "wszNameText", "text", "identity", { required: true, help: "Até 40 caracteres; mantenha um identificador técnico legível." }),
  iconName: field("iconName", "Ícone", "szIcon_Name", "text", "identity", { required: true, help: "Nome de um ícone de skill já empacotado no cliente." }),
  valid: field("valid", "Skill ativa", "bValidity_Able", "checkbox", "identity", { required: true }),

  classFlag: field("classFlag", "Classes permitidas", "dwPC_Class_Bit_Flag", "bitflag", "classification", { ...dword, help: "Selecione as classes pelo nome. O número técnico é calculado automaticamente." }),
  classType: field("classType", "Tipo de classe", "byClass_Type", "number", "classification", { ...byte, help: "Campo interno herdado da base. Preserve-o salvo quando houver uma regra conhecida para a nova classe." }),
  skillClass: field("skillClass", "Categoria", "bySkill_Class", "select", "classification", { ...byte, locked: true, options: SKILL_CLASS_OPTIONS }),
  skillType: field("skillType", "Tipo de dano/efeito", "bySkill_Type", "select", "classification", { ...byte, options: SKILL_TYPE_OPTIONS }),
  activeType: field("activeType", "Comportamento principal", "bySkill_Active_Type", "select", "classification", { ...byte, options: ACTIVE_TYPE_OPTIONS }),
  buffGroup: field("buffGroup", "Grupo de buff/debuff", "byBuff_Group", "number", "classification", { ...byte, help: "Buffs com o mesmo grupo podem substituir uns aos outros. 255 significa sem grupo e permite empilhamento." }),
  slotIndex: field("slotIndex", "Posição na árvore", "bySlot_Index", "number", "classification", { ...byte, help: "Posição visual/relacional na árvore de skills. Ao clonar uma grade, normalmente deve acompanhar a família escolhida." }),
  grade: field("grade", "Grade da habilidade", "bySkill_Grade", "number", "classification", { ...byte, help: "Nível da skill dentro da sequência. Ex.: Kamehameha 110211–110218 usa grades 1–8." }),
  skillGroup: field("skillGroup", "Família/grupo da skill", "bySkill_Group", "number", "classification", { ...byte, help: "Identificador que relaciona skills da mesma família. Preserve o valor da base quando estiver criando outra grade." }),
  functionFlag: field("functionFlag", "Comportamentos especiais", "dwFunction_Bit_Flag", "bitflag", "classification", { ...dword, help: "Selecione comportamentos conhecidos pelo nome; a máscara numérica é calculada automaticamente." }),

  appointTarget: field("appointTarget", "Como indicar o alvo", "byAppoint_Target", "select", "targeting", { ...byte, options: APPOINT_TARGET_OPTIONS }),
  applyTarget: field("applyTarget", "Quem recebe o efeito", "byApply_Target", "select", "targeting", { ...byte, options: APPLY_TARGET_OPTIONS }),
  applyTargetMax: field("applyTargetMax", "Máximo de alvos", "byApply_Target_Max", "number", "targeting", byte),
  applyRange: field("applyRange", "Formato da área", "byApply_Range", "select", "targeting", { ...byte, options: APPLY_RANGE_OPTIONS }),
  applyAreaSize1: field("applyAreaSize1", "Área 1", "byApply_Area_Size_1", "number", "targeting", byte),
  applyAreaSize2: field("applyAreaSize2", "Área 2", "byApply_Area_Size_2", "number", "targeting", byte),

  effectIds: field("effectIds", "Efeitos do sistema", "skill_Effect[2]", "number-list", "effects", { help: "Até 2 TBLIDX de Table_System_Effect_Data. Use 4294967295 para deixar o espaço vazio." }),
  effectTypes: field("effectTypes", "Como aplicar cada efeito", "bySkill_Effect_Type[2]", "number-list", "effects", { help: "Define se o valor ao lado é absoluto, percentual ou fração de um atributo." }),
  effectValues: field("effectValues", "Valores dos efeitos", "aSkill_Effect_Value[2]", "number-list", "effects", { help: "Um valor por efeito. O significado depende de 'Como aplicar cada efeito'." }),
  additionalAggro: field("additionalAggro", "Aggro adicional", "dwAdditional_Aggro_Point", "number", "effects", dword),
  rpEffects: field("rpEffects", "Bônus de RP", "abyRpEffect[6]", "number-list", "effects", { help: "Seis slots de posição fixa; cada um liga ou desliga o bônus daquela posição." }),
  rpEffectValues: field("rpEffectValues", "Valores de RP", "afRpEffectValue[6]", "number-list", "effects", { help: "Valor de cada slot de RP, na mesma ordem." }),
  successRate: field("successRate", "Taxa de sucesso", "fSuccess_Rate", "number", "effects", { min: 0, step: 0.01 }),

  requiredLevel: field("requiredLevel", "Nível para aprender", "byRequire_Train_Level", "number", "requirements", { ...byte, help: "Nível mínimo do personagem para aprender esta grade." }),
  requiredZenny: field("requiredZenny", "Custo em Zeni", "dwRequire_Zenny", "number", "requirements", { ...dword, help: "Valor cobrado ao aprender a skill. Zero significa gratuito." }),
  requiredSp: field("requiredSp", "Custo em SP", "wRequireSP", "number", "requirements", { ...word, help: "Pontos de skill consumidos para aprender esta grade." }),
  selfTrain: field("selfTrain", "Aprendível sem treinador", "bSelfTrain", "checkbox", "requirements", { help: "Quando ativo, o jogador pode aprender pela própria árvore de skills." }),
  prerequisiteSkillIds: field("prerequisiteSkillIds", "Skills pré-requisito", "uiRequire_Skill_Tblidx_[Min/Max]_[1/2]", "number-list", "requirements", { help: "4 TBLIDX na ordem mínimo 1, máximo 1, mínimo 2, máximo 2. Cada par define uma faixa de grades exigida; use 4294967295 para deixar vazio." }),
  rootSkillId: field("rootSkillId", "Skill raiz", "Root_Skill", "reference", "requirements", { ...dword, help: "Primeira habilidade da sequência. A interface tenta resolver o TBLIDX para um nome." }),
  requiredEquipSlotType: field("requiredEquipSlotType", "Equipamento exigido", "byRequire_Epuip_Slot_Type", "select", "requirements", { ...byte, options: [...EQUIP_SLOT_OPTIONS, { value: 255, label: "Nenhum slot específico" }] }),
  requiredItemType: field("requiredItemType", "Tipo de item exigido", "byRequire_Item_Type", "select", "requirements", { ...byte, options: REQUIRED_ITEM_OPTIONS }),
  requiredLp: field("requiredLp", "LP consumido ao usar", "dwRequire_LP", "number", "requirements", { ...dword, help: "Custo de vida por ativação. Normalmente zero." }),
  requiredEp: field("requiredEp", "EP consumido ao usar", "wRequire_EP", "number", "requirements", { ...word, help: "Custo de energia por ativação." }),
  requiredRpBalls: field("requiredRpBalls", "Bolas de RP exigidas", "byRequire_RP_Ball", "number", "requirements", { ...byte, help: "Quantidade mínima de bolas de RP para usar a habilidade." }),
  requiredVp: field("requiredVp", "VP consumido", "dwRequire_VP", "number", "requirements", { ...dword, help: "Usado principalmente por skills de mascote; preserve zero em skills comuns." }),

  castingTimeMs: field("castingTimeMs", "Casting (ms)", "dwCastingTimeInMilliSecs", "number", "timing", dword),
  cooldownMs: field("cooldownMs", "Cooldown (ms)", "dwCoolTimeInMilliSecs", "number", "timing", dword),
  keepTimeMs: field("keepTimeMs", "Duração (ms)", "dwKeepTimeInMilliSecs", "number", "timing", dword),
  keepEffect: field("keepEffect", "Mantém efeito", "bKeep_Effect", "checkbox", "timing"),
  useRangeMin: field("useRangeMin", "Alcance mínimo", "fUse_Range_Min", "number", "timing", { min: 0, step: 0.01 }),
  useRangeMax: field("useRangeMax", "Alcance máximo", "fUse_Range_Max", "number", "timing", { min: 0, step: 0.01 }),

  nextSkillId: field("nextSkillId", "Próxima grade", "dwNextSkillTblidx", "reference", "progression", { ...dword, help: "TBLIDX da grade seguinte. Use 0 ou 4294967295 quando não houver próxima grade, conforme a família clonada." }),
  defaultDisplayOff: field("defaultDisplayOff", "Oculta por padrão", "bDefaultDisplayOff", "checkbox", "progression"),

  animationTimeMs: field("animationTimeMs", "Tempo da animação (ms)", "dwAnimation_Time", "number", "animation", dword),
  castingAnimationStart: field("castingAnimationStart", "Animação inicial do casting", "wCasting_Animation_Start", "number", "animation", word),
  castingAnimationLoop: field("castingAnimationLoop", "Loop do casting", "wCasting_Animation_Loop", "number", "animation", word),
  actionAnimation: field("actionAnimation", "Animação da ação", "wAction_Animation_Index", "number", "animation", word),
  actionLoopAnimation: field("actionLoopAnimation", "Loop da ação", "wAction_Loop_Animation_Index", "number", "animation", word),
  actionEndAnimation: field("actionEndAnimation", "Animação final", "wAction_End_Animation_Index", "number", "animation", word),
  dashAble: field("dashAble", "Permite dash", "bDash_Able", "checkbox", "animation"),

  classChange: field("classChange", "Mudar classe ao aprender", "byPC_Class_Change", "select", "advanced", { ...byte, options: [{ value: 255, label: "Não mudar a classe" }, ...CHARACTER_CLASS_OPTIONS], help: "Atenção: uma classe diferente de 255 pode alterar de verdade a classe do personagem." }),
  useType: field("useType", "Tipo técnico de uso", "byUse_Type", "number", "advanced", { ...byte, help: "Não há enumeração confiável nesta base. Preserve o valor da skill clonada." }),
  restrictionRuleFlag: field("restrictionRuleFlag", "Regras técnicas de restrição", "dwUse_Restriction_Rule_Bit_Flag", "bitflag", "advanced", { ...dword, help: "Máscara avançada sem enumeração completa nesta base. Mantenha o valor herdado até mapearmos cada bit com segurança." }),
};

const IDENTITY: SkillCreationFieldId[] = ["tblidx", "name", "description", "internalName", "iconName", "valid"];
const CLASSIFICATION: SkillCreationFieldId[] = ["classFlag", "classType", "skillClass", "skillType", "activeType", "buffGroup", "slotIndex", "grade", "skillGroup", "functionFlag"];
const TARGETING: SkillCreationFieldId[] = ["appointTarget", "applyTarget", "applyTargetMax", "applyRange", "applyAreaSize1", "applyAreaSize2"];
const EFFECTS: SkillCreationFieldId[] = ["effectIds", "effectTypes", "effectValues", "additionalAggro", "rpEffects", "rpEffectValues", "successRate"];
const REQUIREMENTS: SkillCreationFieldId[] = ["requiredLevel", "requiredZenny", "requiredSp", "selfTrain", "prerequisiteSkillIds", "rootSkillId", "requiredEquipSlotType", "requiredItemType", "requiredLp", "requiredEp", "requiredRpBalls", "requiredVp"];
const TIMING: SkillCreationFieldId[] = ["castingTimeMs", "cooldownMs", "keepTimeMs", "keepEffect", "useRangeMin", "useRangeMax"];
const PROGRESSION: SkillCreationFieldId[] = ["nextSkillId", "defaultDisplayOff"];
const ANIMATION: SkillCreationFieldId[] = ["animationTimeMs", "castingAnimationStart", "castingAnimationLoop", "actionAnimation", "actionLoopAnimation", "actionEndAnimation", "dashAble"];
const ADVANCED: SkillCreationFieldId[] = ["classChange", "useType", "restrictionRuleFlag"];

export type SkillCreationProfile = { skillClass: number; label: string; notes: string; fields: SkillCreationFieldId[] };
export const SKILL_CREATION_PROFILES: SkillCreationProfile[] = [
  { skillClass: 0, label: "Passiva", notes: "Efeito permanente ou condicional. Não utiliza seleção de alvo, casting ou animação de ação.", fields: [...IDENTITY, ...CLASSIFICATION, ...EFFECTS, ...REQUIREMENTS, ...PROGRESSION, ...ADVANCED] },
  { skillClass: 1, label: "Ativa", notes: "Pode consumir recursos, selecionar alvos, aplicar efeitos, possuir cooldown e executar animações.", fields: [...IDENTITY, ...CLASSIFICATION, ...TARGETING, ...EFFECTS, ...REQUIREMENTS, ...TIMING, ...PROGRESSION, ...ANIMATION, ...ADVANCED] },
  { skillClass: 2, label: "HTB", notes: "Sequência cinematográfica de combate. Exige uma base HTB para preservar referências e comportamento interno.", fields: [...IDENTITY, ...CLASSIFICATION, ...TARGETING, ...EFFECTS, ...REQUIREMENTS, ...TIMING, ...PROGRESSION, ...ANIMATION, ...ADVANCED] },
];

export function getSkillCreationProfile(skillClass: number) { return SKILL_CREATION_PROFILES.find((profile) => profile.skillClass === skillClass); }
export function getFieldsForSkillClass(skillClass: number) { return (getSkillCreationProfile(skillClass)?.fields ?? []).map((id) => SKILL_CREATION_FIELDS[id]); }

export function getSkillCreationBaseValues(skill: SkillCatalogEntry): Record<string, SkillDraftValue> {
  return Object.fromEntries(Object.keys(SKILL_CREATION_FIELDS).map((id) => [id, skill[id as keyof SkillCatalogEntry] as SkillDraftValue]));
}
