import type { ItemCatalogEntry, ItemDraftValue } from "@/lib/types";

export type ItemCreationProfileId =
  | "weapon"
  | "armor"
  | "accessory"
  | "scouter"
  | "scouterPart"
  | "costume"
  | "container"
  | "consumable"
  | "material"
  | "recipe"
  | "specialized";

export type ItemCreationFieldId =
  | "tblidx" | "name" | "description" | "iconName" | "valid" | "rank"
  | "maxStack" | "weight" | "cost" | "sellPrice" | "modelType" | "modelName"
  | "subWeaponModelName" | "equipType" | "equipSlotFlag" | "durability"
  | "battleAttribute" | "physicalOffence" | "energyOffence" | "physicalDefence"
  | "energyDefence" | "attackRangeBonus" | "attackSpeedRate" | "minimumLevel"
  | "maximumLevel" | "classFlag" | "genderFlag" | "classSpecial" | "raceSpecial"
  | "needStr" | "needCon" | "needFoc" | "needDex" | "needSol" | "needEng"
  | "setItemTblidx" | "bagSize" | "scouterWatt" | "scouterMaxPower"
  | "scouterParts" | "useItemTblidx" | "canHaveOption" | "itemOptionTblidx"
  | "costumeHideFlag" | "needItemTblidx" | "commonPoint" | "commonPointType"
  | "useDurationMax" | "durationType" | "contentsTblidx" | "durationGroup"
  | "dropLevel" | "enchantRateTblidx" | "excellentTblidx" | "rareTblidx"
  | "legendaryTblidx" | "creationRanks" | "restrictType" | "revisions"
  | "renewal" | "disassemble";

export type ItemCreationField = {
  id: ItemCreationFieldId;
  label: string;
  sourceField: string;
  control: "text" | "number" | "checkbox" | "select" | "bitflag" | "reference";
  group: "identity" | "inventory" | "economy" | "visual" | "equipment" | "combat" | "requirements" | "options" | "behavior" | "advanced";
  required?: boolean;
  min?: number;
  max?: number;
  help?: string;
};

const field = (
  id: ItemCreationFieldId,
  label: string,
  sourceField: string,
  control: ItemCreationField["control"],
  group: ItemCreationField["group"],
  extra: Omit<ItemCreationField, "id" | "label" | "sourceField" | "control" | "group"> = {},
): ItemCreationField => ({ id, label, sourceField, control, group, ...extra });

export const ITEM_CREATION_FIELDS: Record<ItemCreationFieldId, ItemCreationField> = {
  tblidx: field("tblidx", "TBLIDX", "tblidx", "number", "identity", { required: true, min: 1, max: 4294967294, help: "Identificador único em todas as versões do catálogo." }),
  name: field("name", "Nome", "Name + ITEM_DATA text", "text", "identity", { required: true }),
  description: field("description", "Descrição", "Note + ITEM_DATA text", "text", "identity"),
  iconName: field("iconName", "Ícone", "szIcon_Name", "text", "visual", { required: true, help: "Arquivo existente em texture/gui/icon ou novo recurso a empacotar." }),
  valid: field("valid", "Item ativo", "bValidity_Able", "checkbox", "identity", { required: true }),
  rank: field("rank", "Rank", "byRank", "select", "inventory", { required: true, min: 0, max: 5 }),
  maxStack: field("maxStack", "Pilha máxima", "byMax_Stack", "number", "inventory", { required: true, min: 1, max: 255 }),
  weight: field("weight", "Peso", "dwWeight", "number", "inventory", { min: 0, max: 4294967295 }),
  cost: field("cost", "Preço de compra", "dwCost", "number", "economy", { min: 0, max: 4294967295 }),
  sellPrice: field("sellPrice", "Preço de venda", "dwSell_Price", "number", "economy", { min: 0, max: 4294967295 }),
  modelType: field("modelType", "Tipo de modelo", "byModel_Type", "select", "visual", { min: 0, max: 2 }),
  modelName: field("modelName", "Modelo", "szModel", "text", "visual"),
  subWeaponModelName: field("subWeaponModelName", "Modelo de ação da subarma", "szSub_Weapon_Act_Model", "text", "visual"),
  equipType: field("equipType", "Tipo de equipamento", "byEquip_Type", "select", "equipment", { min: 0, max: 255 }),
  equipSlotFlag: field("equipSlotFlag", "Slots permitidos", "dwEquip_Slot_Type_Bit_Flag", "bitflag", "equipment"),
  durability: field("durability", "Durabilidade", "byDurability", "number", "equipment", { min: 0, max: 255 }),
  battleAttribute: field("battleAttribute", "Atributo de batalha", "byBattle_Attribute", "select", "combat", { min: 0, max: 255 }),
  physicalOffence: field("physicalOffence", "Ataque físico", "wPhysical_Offence", "number", "combat", { min: 0, max: 65535 }),
  energyOffence: field("energyOffence", "Ataque de energia", "wEnergy_Offence", "number", "combat", { min: 0, max: 65535 }),
  physicalDefence: field("physicalDefence", "Defesa física", "wPhysical_Defence", "number", "combat", { min: 0, max: 65535 }),
  energyDefence: field("energyDefence", "Defesa de energia", "wEnergy_Defence", "number", "combat", { min: 0, max: 65535 }),
  attackRangeBonus: field("attackRangeBonus", "Bônus de alcance", "fAttack_Range_Bonus", "number", "combat"),
  attackSpeedRate: field("attackSpeedRate", "Velocidade de ataque", "wAttack_Speed_Rate", "number", "combat", { min: 0, max: 65535 }),
  minimumLevel: field("minimumLevel", "Nível mínimo", "byNeed_Min_Level", "number", "requirements", { min: 0, max: 255 }),
  maximumLevel: field("maximumLevel", "Nível máximo", "byNeed_Max_Level", "number", "requirements", { min: 0, max: 255 }),
  classFlag: field("classFlag", "Classes permitidas", "dwNeed_Class_Bit_Flag", "bitflag", "requirements"),
  genderFlag: field("genderFlag", "Gêneros permitidos", "dwNeed_Gender_Bit_Flag", "bitflag", "requirements"),
  classSpecial: field("classSpecial", "Classe especial", "byClass_Special", "select", "requirements", { min: 0, max: 255 }),
  raceSpecial: field("raceSpecial", "Raça especial", "byRace_Special", "select", "requirements", { min: 0, max: 255 }),
  needStr: field("needStr", "STR necessária", "wNeed_Str", "number", "requirements", { min: 0, max: 65535 }),
  needCon: field("needCon", "CON necessária", "wNeed_Con", "number", "requirements", { min: 0, max: 65535 }),
  needFoc: field("needFoc", "FOC necessária", "wNeed_Foc", "number", "requirements", { min: 0, max: 65535 }),
  needDex: field("needDex", "DEX necessária", "wNeed_Dex", "number", "requirements", { min: 0, max: 65535 }),
  needSol: field("needSol", "SOL necessária", "wNeed_Sol", "number", "requirements", { min: 0, max: 65535 }),
  needEng: field("needEng", "ENG necessária", "wNeed_Eng", "number", "requirements", { min: 0, max: 65535 }),
  setItemTblidx: field("setItemTblidx", "Conjunto de itens", "set_Item_Tblidx", "reference", "options"),
  bagSize: field("bagSize", "Tamanho do compartimento", "byBag_Size", "select", "behavior", { help: "Valores existentes: 4, 8, 12, 16, 20, 24, 28 ou 32." }),
  scouterWatt: field("scouterWatt", "Watt do scouter", "wScouter_Watt", "number", "behavior", { min: 0, max: 65535 }),
  scouterMaxPower: field("scouterMaxPower", "Poder máximo do scouter", "dwScouter_MaxPower", "number", "behavior", { min: 0, max: 4294967295 }),
  scouterParts: field("scouterParts", "Tipos de peças do scouter", "byScouter_Parts_Type1..4", "bitflag", "behavior"),
  useItemTblidx: field("useItemTblidx", "Comportamento de uso", "Use_Item_Tblidx", "reference", "behavior", { help: "Referência obrigatória para a maioria dos itens consumíveis." }),
  canHaveOption: field("canHaveOption", "Aceita opções", "bIsCanHaveOption", "checkbox", "options"),
  itemOptionTblidx: field("itemOptionTblidx", "Opção fixa", "Item_Option_Tblidx", "reference", "options"),
  costumeHideFlag: field("costumeHideFlag", "Partes ocultadas pelo costume", "wCostumeHideBitFlag", "bitflag", "visual"),
  needItemTblidx: field("needItemTblidx", "Item necessário", "NeedItemTblidx", "reference", "behavior"),
  commonPoint: field("commonPoint", "Pontos necessários", "CommonPoint", "number", "economy", { min: 0, max: 4294967295 }),
  commonPointType: field("commonPointType", "Tipo de ponto", "byCommonPointType", "select", "economy", { min: 0, max: 255 }),
  useDurationMax: field("useDurationMax", "Duração máxima", "dwUseDurationMax", "number", "behavior", { min: 0, max: 4294967295 }),
  durationType: field("durationType", "Tipo de duração", "byDurationType", "select", "behavior", { min: 0, max: 255 }),
  contentsTblidx: field("contentsTblidx", "Conteúdo associado", "contentsTblidx", "reference", "advanced"),
  durationGroup: field("durationGroup", "Grupo de duração", "dwDurationGroup", "number", "advanced", { min: 0, max: 4294967295 }),
  dropLevel: field("dropLevel", "Nível de drop", "byDropLevel", "number", "advanced", { min: 0, max: 255 }),
  enchantRateTblidx: field("enchantRateTblidx", "Tabela de encantamento", "enchantRateTblidx", "reference", "options"),
  excellentTblidx: field("excellentTblidx", "Opções excelentes", "excellentTblidx", "reference", "options"),
  rareTblidx: field("rareTblidx", "Opções raras", "rareTblidx", "reference", "options"),
  legendaryTblidx: field("legendaryTblidx", "Opções lendárias", "legendaryTblidx", "reference", "options"),
  creationRanks: field("creationRanks", "Ranks que podem ser criados", "bCreate*Able", "bitflag", "options"),
  restrictType: field("restrictType", "Restrição do item", "byRestrictType", "select", "advanced", { min: 0, max: 255 }),
  revisions: field("revisions", "Revisões de combate", "fAttack/Defence_*_Revision", "number", "advanced"),
  renewal: field("renewal", "Permite renovação", "bIsCanRenewal", "checkbox", "advanced"),
  disassemble: field("disassemble", "Configuração de desmontagem", "wDisassemble_Bit_Flag + byDisassemble*", "bitflag", "advanced"),
};

const COMMON: ItemCreationFieldId[] = ["tblidx", "name", "description", "iconName", "valid", "rank", "maxStack", "weight", "cost", "sellPrice"];
const VISUAL: ItemCreationFieldId[] = ["modelType", "modelName", "subWeaponModelName"];
const EQUIPMENT: ItemCreationFieldId[] = ["equipType", "equipSlotFlag", "durability", "battleAttribute"];
const REQUIREMENTS: ItemCreationFieldId[] = ["minimumLevel", "maximumLevel", "classFlag", "genderFlag", "classSpecial", "raceSpecial", "needStr", "needCon", "needFoc", "needDex", "needSol", "needEng"];
const OPTIONS: ItemCreationFieldId[] = ["canHaveOption", "itemOptionTblidx", "setItemTblidx", "enchantRateTblidx", "excellentTblidx", "rareTblidx", "legendaryTblidx", "creationRanks"];
const ADVANCED: ItemCreationFieldId[] = ["needItemTblidx", "commonPoint", "commonPointType", "contentsTblidx", "dropLevel", "restrictType", "renewal", "disassemble"];

export const ITEM_CREATION_PROFILES: Record<ItemCreationProfileId, { label: string; fields: ItemCreationFieldId[]; cloneRequired: boolean; notes: string }> = {
  weapon: { label: "Arma", fields: [...COMMON, ...VISUAL, ...EQUIPMENT, "physicalOffence", "energyOffence", "attackRangeBonus", "attackSpeedRate", ...REQUIREMENTS, ...OPTIONS, "revisions", ...ADVANCED], cloneRequired: true, notes: "Ataques e velocidade são campos básicos; slot/equip type devem partir de uma arma do mesmo tipo." },
  armor: { label: "Armadura", fields: [...COMMON, ...VISUAL, ...EQUIPMENT, "physicalDefence", "energyDefence", ...REQUIREMENTS, ...OPTIONS, "revisions", ...ADVANCED], cloneRequired: true, notes: "Jaqueta, calça e botas diferem principalmente pelo slot fixo." },
  accessory: { label: "Acessório", fields: [...COMMON, "equipType", "equipSlotFlag", ...REQUIREMENTS, ...OPTIONS, ...ADVANCED], cloneRequired: true, notes: "Os atributos normalmente vêm das tabelas de opções, não dos campos de defesa." },
  scouter: { label: "Scouter", fields: [...COMMON, ...VISUAL, ...EQUIPMENT, ...REQUIREMENTS, "bagSize", "scouterWatt", "scouterMaxPower", "scouterParts", ...ADVANCED], cloneRequired: true, notes: "O scouter combina durabilidade, capacidade e referências próprias." },
  scouterPart: { label: "Peça de scouter", fields: [...COMMON, ...REQUIREMENTS, "scouterParts", ...OPTIONS, ...ADVANCED], cloneRequired: true, notes: "As opções são essenciais; deve copiar uma peça compatível." },
  costume: { label: "Costume", fields: [...COMMON, ...VISUAL, "equipType", "equipSlotFlag", "costumeHideFlag", ...REQUIREMENTS, ...ADVANCED], cloneRequired: true, notes: "Modelo, slot visual e partes ocultadas precisam ser coerentes." },
  container: { label: "Bolsa/armazenamento", fields: [...COMMON, "bagSize", ...REQUIREMENTS, ...ADVANCED], cloneRequired: true, notes: "A capacidade deve usar um dos tamanhos reconhecidos pelo cliente." },
  consumable: { label: "Consumível", fields: [...COMMON, ...REQUIREMENTS, "useItemTblidx", "needItemTblidx", "useDurationMax", "durationType", "durationGroup", "contentsTblidx", "commonPoint", "commonPointType", "restrictType"], cloneRequired: true, notes: "Criar o registro do item não cria seu efeito; Use_Item_Tblidx deve apontar para comportamento válido." },
  material: { label: "Material", fields: [...COMMON, ...REQUIREMENTS, "needItemTblidx", "commonPoint", "commonPointType", "restrictType", "disassemble"], cloneRequired: true, notes: "Em geral é empilhável e não possui modelo ou comportamento de uso." },
  recipe: { label: "Receita", fields: [...COMMON, ...REQUIREMENTS, "useItemTblidx", "needItemTblidx", "contentsTblidx", "restrictType"], cloneRequired: true, notes: "Também exige um registro compatível em Table_Item_Recipe_Data." },
  specialized: { label: "Item especializado", fields: [...COMMON, ...VISUAL, ...EQUIPMENT, ...REQUIREMENTS, ...OPTIONS, "useItemTblidx", "needItemTblidx", "useDurationMax", "durationType", "contentsTblidx", ...ADVANCED], cloneRequired: true, notes: "Somente clonagem nesta fase; pode depender de código e tabelas adicionais." },
};

type ItemTypeDefinition = {
  value: number;
  label: string;
  profile: ItemCreationProfileId;
  defaultEquipType?: number;
  defaultSlotFlag?: number;
  observed?: boolean;
  custom?: boolean;
};

const type = (value: number, label: string, profile: ItemCreationProfileId, extra: Omit<ItemTypeDefinition, "value" | "label" | "profile"> = {}): ItemTypeDefinition => ({ value, label, profile, ...extra });

export const ITEM_TYPE_CREATION_DEFINITIONS: ItemTypeDefinition[] = [
  type(0, "Luva", "weapon", { defaultSlotFlag: 1, observed: true }), type(1, "Cajado", "weapon", { defaultSlotFlag: 1, observed: true }),
  type(2, "Arma", "weapon"), type(3, "Armas duplas", "weapon"),
  ...[[4,"Garra"],[5,"Machado"],[6,"Pergaminho"],[7,"Gema"],[8,"Bastão"],[9,"Espada"],[10,"Leque"],[11,"Varinha"],[12,"Bazuca"],[13,"Mochila de combate"],[14,"Instrumento"],[15,"Clava"],[16,"Tambor"],[17,"Máscara"]].map(([value, label]) => type(value as number, label as string, "weapon", { defaultEquipType: 1, defaultSlotFlag: 2, observed: ![12,13].includes(value as number) })),
  type(18, "Jaqueta", "armor", { defaultEquipType: 2, defaultSlotFlag: 4, observed: true }),
  type(19, "Calça", "armor", { defaultEquipType: 2, defaultSlotFlag: 8, observed: true }),
  type(20, "Botas", "armor", { defaultEquipType: 2, defaultSlotFlag: 16, observed: true }),
  type(21, "Colar", "accessory", { defaultEquipType: 5, defaultSlotFlag: 128, observed: true }),
  type(22, "Brinco", "accessory", { defaultEquipType: 5, defaultSlotFlag: 768, observed: true }),
  type(23, "Anel", "accessory", { defaultEquipType: 5, defaultSlotFlag: 3072, observed: true }),
  type(24, "Scouter", "scouter", { defaultEquipType: 3, defaultSlotFlag: 32, observed: true }),
  type(25, "Peça de scouter", "scouterPart", { observed: true }), type(26, "Costume antigo", "specialized", { observed: true }),
  type(27, "Bolsa", "container", { observed: true }), type(28, "Item de missão", "consumable", { observed: true }),
  type(29, "Pedra", "material"), type(30, "Recuperação", "consumable", { observed: true }), type(31, "Comida", "consumable", { observed: true }),
  type(32, "Utilidade", "consumable", { observed: true }), type(33, "Amuleto", "consumable"), type(34, "Cápsula/veículo", "consumable", { observed: true }),
  type(35, "Combustível", "consumable", { observed: true }), type(36, "Sucata", "material", { observed: true }), type(37, "Coleção", "material"),
  type(38, "Armazenamento", "container", { observed: true }), type(39, "Dragon Ball", "specialized", { observed: true }), type(40, "Aposta", "consumable", { observed: true }),
  type(41, "Material", "material", { observed: true }), type(42, "Receita", "recipe", { observed: true }), type(43, "Hoi-Poi Rock", "material", { observed: true }),
  type(44, "Dogi", "costume", { defaultEquipType: 6, defaultSlotFlag: 4096, observed: true }), type(45, "Pedra pura", "material"), type(46, "Pedra negra", "material"),
  type(47, "NetPy Store", "specialized", { observed: true }), type(48, "Teleporte rápido", "consumable", { observed: true }), type(49, "Core Stone vazio", "material"),
  type(50, "Crescent Popo", "consumable", { observed: true }), type(51, "Party Popo", "consumable", { observed: true }), type(52, "Reset de SP", "consumable"),
  type(53, "Slot adicional de personagem", "specialized"), type(54, "Alteração de nome do personagem", "consumable", { observed: true }), type(55, "Alteração de nome da guilda", "consumable", { observed: true }),
  type(56, "Tintura de Dogi", "consumable", { observed: true }), type(57, "Corpo de mascote", "specialized", { observed: true }), type(58, "Comida de mascote", "consumable", { observed: true }),
  type(59, "Anel de mascote", "specialized", { observed: true }), type(60, "Stone Core", "material", { observed: true }), type(61, "Stone Core antigo", "material"),
  type(62, "Reset de SP Plus", "consumable", { observed: true }), type(63, "Buff comercial", "consumable", { observed: true }), type(64, "Stone Core Plus", "material"),
  type(65, "Conjunto de costume", "costume", { defaultEquipType: 6, defaultSlotFlag: 4096, observed: true }),
  type(66, "Cabelo de costume", "costume", { defaultEquipType: 6, defaultSlotFlag: 8192, observed: true }),
  type(67, "Máscara de costume", "costume", { defaultEquipType: 6, defaultSlotFlag: 16384, observed: true }),
  type(68, "Acessório de cabelo", "costume", { defaultEquipType: 6, defaultSlotFlag: 32768, observed: true }),
  type(69, "Acessório das costas", "costume", { defaultEquipType: 6, defaultSlotFlag: 65536, observed: true }),
  type(70, "Reset de um ponto de SP", "consumable", { observed: true }), type(71, "Limite adicional de TMQ", "consumable"), type(72, "Ticket de Battle Dungeon", "consumable", { observed: true }),
  type(73, "Pedra de upgrade de arma", "material", { observed: true }), type(74, "Pedra de upgrade de armadura", "material", { observed: true }),
  type(75, "Pedra maior de upgrade de arma", "material", { observed: true }), type(76, "Pedra maior de upgrade de armadura", "material", { observed: true }),
  type(77, "Pedra de downgrade de arma", "material", { observed: true }), type(78, "Pedra de downgrade de armadura", "material", { observed: true }),
  type(79, "Comida nova", "consumable", { observed: true }), type(80, "Caixa fechada", "consumable", { observed: true }), type(81, "Chave", "consumable", { observed: true }),
  type(82, "Moeda de evento", "material", { observed: true }), type(83, "Cupom de upgrade de arma", "consumable", { observed: true }),
  type(84, "Cupom de upgrade de armadura", "consumable", { observed: true }), type(85, "Cupom de upgrade completo", "consumable"),
  type(86, "Pó de troca de upgrade", "material"), type(87, "Selo", "consumable", { observed: true }),
  type(88, "Tipo customizado 88", "specialized", { observed: true, custom: true }), type(89, "Kit de alteração de opção", "consumable", { observed: true }),
  type(90, "Esfera de propriedade", "consumable", { observed: true }), type(91, "Destruidor de esfera", "consumable", { observed: true }),
  type(92, "Mascote", "specialized", { observed: true }), type(93, "Comida de EXP de mascote", "consumable", { observed: true }),
  type(94, "Comida de mascote de evento", "consumable", { observed: true }), type(95, "Comida automática de mascote", "consumable", { observed: true }),
  type(96, "Tipo customizado 96", "specialized", { observed: true, custom: true }), type(97, "Alteração de skill de mascote", "consumable", { observed: true }),
  type(98, "Level-up de mascote", "consumable", { observed: true }), type(99, "Tipo customizado 99", "specialized", { observed: true, custom: true }),
  type(100, "Selo de evento", "consumable", { observed: true }), type(106, "Scouter customizado 106", "scouter", { defaultEquipType: 3, defaultSlotFlag: 32, observed: true, custom: true }),
];

export function getItemCreationDefinition(itemType: number) {
  return ITEM_TYPE_CREATION_DEFINITIONS.find((definition) => definition.value === itemType);
}

export function getFieldsForItemType(itemType: number) {
  const definition = getItemCreationDefinition(itemType);
  if (!definition) return [];
  return ITEM_CREATION_PROFILES[definition.profile].fields.map((fieldId) => ITEM_CREATION_FIELDS[fieldId]);
}

export function getItemCreationBaseValues(item: ItemCatalogEntry): Record<string, ItemDraftValue> {
  return {
    tblidx: item.tblidx,
    name: item.name,
    description: item.description,
    iconName: item.iconName,
    valid: item.valid,
    rank: item.rank,
    maxStack: item.maxStack,
    weight: item.weight,
    cost: item.cost,
    sellPrice: item.sellPrice,
    modelType: item.modelType,
    modelName: item.modelName,
    subWeaponModelName: item.subWeaponModelName,
    equipType: item.equipType,
    equipSlotFlag: item.equipSlotFlag,
    durability: item.durability,
    battleAttribute: item.battleAttribute,
    physicalOffence: item.physicalOffence,
    energyOffence: item.energyOffence,
    physicalDefence: item.physicalDefence,
    energyDefence: item.energyDefence,
    attackRangeBonus: item.attackRangeBonus,
    attackSpeedRate: item.attackSpeedRate,
    minimumLevel: item.minimumLevel,
    maximumLevel: item.maximumLevel,
    classFlag: item.classFlag,
    genderFlag: item.genderFlag,
    classSpecial: item.classSpecial,
    raceSpecial: item.raceSpecial,
    needStr: item.needStr,
    needCon: item.needCon,
    needFoc: item.needFoc,
    needDex: item.needDex,
    needSol: item.needSol,
    needEng: item.needEng,
    setItemTblidx: item.setItemTblidx,
    bagSize: item.bagSize,
    scouterWatt: item.scouterWatt,
    scouterMaxPower: item.scouterMaxPower,
    scouterParts: item.scouterParts,
    useItemTblidx: item.useItemTblidx,
    canHaveOption: item.canHaveOption,
    itemOptionTblidx: item.itemOptionTblidx,
    costumeHideFlag: item.costumeHideFlag,
    needItemTblidx: item.needItemTblidx,
    commonPoint: item.commonPoint,
    commonPointType: item.commonPointType,
    useDurationMax: item.useDurationMax,
    durationType: item.durationType,
    contentsTblidx: item.contentsTblidx,
    durationGroup: item.durationGroup,
    dropLevel: item.dropLevel,
    enchantRateTblidx: item.enchantRateTblidx,
    excellentTblidx: item.excellentTblidx,
    rareTblidx: item.rareTblidx,
    legendaryTblidx: item.legendaryTblidx,
    creationRanks: [item.createSuperior ? 1 : 0, item.createExcellent ? 1 : 0, item.createRare ? 1 : 0, item.createLegendary ? 1 : 0],
    restrictType: item.restrictType,
    revisions: [item.attackPhysicalRevision, item.attackEnergyRevision, item.defencePhysicalRevision, item.defenceEnergyRevision],
    renewal: item.renewal,
    disassemble: [item.disassembleFlag, item.disassembleNormalMin, item.disassembleNormalMax, item.disassembleUpperMin, item.disassembleUpperMax, item.dropVisual, item.useDisassemble],
  };
}
