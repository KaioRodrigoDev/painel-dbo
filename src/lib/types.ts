export type CharacterSummary = {
  charId: number;
  accountId: number;
  name: string;
  level: number;
  experience: number;
  skillPoints: number;
  money: number;
  race: number | null;
  characterClass: number | null;
  gender: number | null;
  adult: boolean;
  gameMaster: boolean;
  online: boolean;
  pendingUpdate: CharacterAdminUpdate | null;
};

export type CharacterAdminUpdate = {
  id: number;
  status: "pending" | "waiting_logout";
  level: number;
  experience: number;
  skillPoints: number;
  money: number;
  cash: number;
  requestedAt: string;
};

export type AccountSummary = {
  vip: number;
  vipExpiresAt: string | null;
  accountId: number;
  username: string;
  status: "pending" | "block" | "active";
  email: string;
  adminLevel: number;
  gameMaster: boolean;
  mallPoints: number;
  registeredAt: string | null;
  lastLogin: string | null;
  characters: CharacterSummary[];
};

/** Ações que dependem de uma fila do QueryServer; desligadas quando o servidor não a lê. */
export type GameIntegrations = { characterEdits: boolean; mail: boolean; cashShop: boolean };

export type AccountsResponse = {
  accounts: AccountSummary[];
  vipExpirySupported: boolean;
  /** Quais ações dependem de fila que o servidor realmente processa. */
  integrations: GameIntegrations;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type EditableCharacterFields = {
  level: number;
  experience: number;
  skillPoints: number;
  money: number;
  cash: number;
};

export type ManagedServerStatus = "online" | "offline";

export type ManagedServer = {
  id: string;
  kind: "core" | "game";
  name: string;
  executable: string;
  configFile: string | null;
  channel: number | null;
  port: number | null;
  channelName: string | null;
  selected: boolean;
  status: ManagedServerStatus;
  pid: number | null;
  startedAt: string | null;
};

export type UnmanagedGameProcess = {
  pid: number;
  startedAt: string | null;
};

export type ServerManagerSnapshot = {
  executionDirectory: string;
  services: ManagedServer[];
  selectedGameConfigs: string[];
  unmanagedGameProcesses: UnmanagedGameProcess[];
  updatedAt: string;
};

export type ItemCatalogEntry = {
  tblidx: number;
  valid: boolean;
  nameTextId: number;
  noteTextId: number;
  name: string;
  description: string;
  internalName: string;
  iconName: string;
  modelName: string;
  subWeaponModelName: string;
  modelType: number;
  itemType: number;
  equipType: number;
  equipSlotFlag: number;
  functionFlag: number;
  maxStack: number;
  rank: number;
  weight: number;
  cost: number;
  sellPrice: number;
  durability: number;
  durabilityCount: number;
  battleAttribute: number;
  physicalOffence: number;
  energyOffence: number;
  physicalDefence: number;
  energyDefence: number;
  attackRangeBonus: number;
  attackSpeedRate: number;
  minimumLevel: number;
  maximumLevel: number;
  classFlag: number;
  genderFlag: number;
  classSpecial: number;
  raceSpecial: number;
  needStr: number;
  needCon: number;
  needFoc: number;
  needDex: number;
  needSol: number;
  needEng: number;
  setItemTblidx: number;
  bagSize: number;
  scouterWatt: number;
  scouterMaxPower: number;
  scouterParts: number[];
  useItemTblidx: number;
  canHaveOption: boolean;
  itemOptionTblidx: number;
  itemGroup: number;
  charmTblidx: number;
  costumeHideFlag: number;
  needItemTblidx: number;
  commonPoint: number;
  commonPointType: number;
  needFunction: number;
  useDurationMax: number;
  durationType: number;
  contentsTblidx: number;
  durationGroup: number;
  dropLevel: number;
  enchantRateTblidx: number;
  excellentTblidx: number;
  rareTblidx: number;
  legendaryTblidx: number;
  createSuperior: boolean;
  createExcellent: boolean;
  createRare: boolean;
  createLegendary: boolean;
  restrictType: number;
  attackPhysicalRevision: number;
  attackEnergyRevision: number;
  defencePhysicalRevision: number;
  defenceEnergyRevision: number;
  temporaryTableType: number;
  renewal: boolean;
  disassembleFlag: number;
  disassembleNormalMin: number;
  disassembleNormalMax: number;
  disassembleUpperMin: number;
  disassembleUpperMax: number;
  dropVisual: number;
  useDisassemble: number;
  cashShopTblidx?: number;
  cashShopStack?: number;
};

export type ItemCatalogResponse = {
  items: ItemCatalogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sourceFile: string;
  textSourceFile: string;
  sourceUpdatedAt: string;
  availableTypes: number[];
  availableRanks: number[];
};

export type SkillCatalogEntry = {
  tblidx: number;
  valid: boolean;
  nameTextId: number;
  noteTextId: number;
  name: string;
  description: string;
  internalName: string;
  iconName: string;
  classFlag: number;
  classType: number;
  skillClass: number;
  skillType: number;
  activeType: number;
  buffGroup: number;
  slotIndex: number;
  grade: number;
  functionFlag: number;
  appointTarget: number;
  applyTarget: number;
  applyTargetMax: number;
  applyRange: number;
  applyAreaSize1: number;
  applyAreaSize2: number;
  effectIds: number[];
  effectTypes: number[];
  effectValues: number[];
  additionalAggro: number;
  rpEffects: number[];
  rpEffectValues: number[];
  requiredLevel: number;
  requiredZenny: number;
  requiredSp: number;
  selfTrain: boolean;
  prerequisiteSkillIds: number[];
  rootSkillId: number;
  requiredEquipSlotType: number;
  requiredItemType: number;
  requiredLp: number;
  requiredEp: number;
  requiredRpBalls: number;
  castingTimeMs: number;
  cooldownMs: number;
  keepTimeMs: number;
  keepEffect: boolean;
  useRangeMin: number;
  useRangeMax: number;
  nextSkillId: number;
  defaultDisplayOff: boolean;
  animationTimeMs: number;
  castingAnimationStart: number;
  castingAnimationLoop: number;
  actionAnimation: number;
  actionLoopAnimation: number;
  actionEndAnimation: number;
  dashAble: boolean;
  successRate: number;
  classChange: number;
  useType: number;
  skillGroup: number;
  requiredVp: number;
  restrictionRuleFlag: number;
};

export type SkillCatalogResponse = {
  skills: SkillCatalogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sourceFile: string;
  textSourceFile: string;
  sourceUpdatedAt: string;
  availableSkillClasses: number[];
  availableSkillTypes: number[];
};

export type MobCatalogEntry = {
  tblidx: number;
  valid: boolean;
  nameTextId: number;
  name: string;
  internalName: string;
  modelName: string;
  level: number;
  grade: number;
  mobType: number;
  mobKind: number;
  mobGroup: number;
  basicLp: number;
  basicEp: number;
  physicalOffence: number;
  energyOffence: number;
  physicalDefence: number;
  energyDefence: number;
  attackRate: number;
  dodgeRate: number;
  blockRate: number;
  attackSpeedRate: number;
  attackRange: number;
  sightRange: number;
  scanRange: number;
  walkSpeed: number;
  runSpeed: number;
  experience: number;
  dropZenny: number;
  dropZennyRate: number;
  battleAttribute: number;
  allianceId: number;
  monsterClass: number;
  dragonBallDrop: boolean;
  showName: boolean;
};

export type MobCatalogResponse = {
  mobs: MobCatalogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sourceFile: string;
  textSourceFile: string;
  sourceUpdatedAt: string;
  availableGrades: number[];
  availableTypes: number[];
};

/** Um item dentro de uma bag de drop, com a probabilidade que a bag dá a ele. */
export type MobDropItem = {
  tblidx: number;
  name: string;
  iconName: string;
  rank: number;
  itemType: number;
  /** adwProb da bag, em porcento (Dbo_CheckProbabilityF compara com 0..100). */
  probability: number;
  /** Referenciado pela bag mas ausente de Table_Item_Data.rdf. */
  missing: boolean;
};

export type MobDropBag = {
  tblidx: number;
  name: string;
  level: number;
  enchantAble: boolean;
  /** Chance de a bag ser aberta, vinda do adwProb do grupo, em porcento. */
  probability: number;
  totalProbability: number;
  /** Referenciada pelo grupo mas ausente de table_item_bag_list_data.rdf. */
  missing: boolean;
  items: MobDropItem[];
};

export type MobDropGroup = {
  tblidx: number;
  name: string;
  level: number;
  /** Quantas vezes o grupo roda por morte (byTry_Count). */
  tryCount: number;
  /** Sorteia 1 item entre todas as bags com peso igual, ignorando as probabilidades. */
  uniformDraw: boolean;
  zenny: number;
  superior: number;
  excellent: number;
  rare: number;
  legendary: number;
  declaredBagCount: number;
  /** declaredBagCount passou das 20 posições do array; o excedente não existe. */
  overflow: boolean;
  bags: MobDropBag[];
};

export type MobDropSection = {
  source: "mob" | "world" | "itemBox";
  label: string;
  /** Nome da regra de mundo, quando source = "world". */
  ruleName: string | null;
  /** O servidor escolhe 1 grupo ao acaso entre os desta seção. */
  drawsOneGroup: boolean;
  note: string;
  groups: MobDropGroup[];
};

export type MobDropsResponse = {
  mob: {
    tblidx: number;
    name: string;
    level: number;
    mobType: number;
    dropZenny: number;
    dropZennyRate: number;
    dragonBallDrop: boolean;
  };
  sections: MobDropSection[];
  warnings: string[];
  levelWindow: { floor: number; ceiling: number };
  sourceUpdatedAt: string;
};

/* ===================== Receitas (HoiPoi Mix) ===================== */

export type RecipeResultValue = { tblidx: number; rate: number; flag: number };
export type RecipeMaterialValue = { tblidx: number; quantity: number };

export type RecipeValues = {
  valid: boolean;
  recipeType: number;
  needMixLevel: number;
  needMixZenny: number;
  /** Até 3; o servidor lê sRECIPE_CREATE_DATA[3]. */
  results: RecipeResultValue[];
  /** Até 5; o servidor lê sRECIPE_MATERIAL_DATA[5]. */
  materials: RecipeMaterialValue[];
};

type ResolvedRef = { name: string; iconName: string; missing: boolean };

export type RecipeEntry = Omit<RecipeValues, "results" | "materials"> & {
  tblidx: number;
  name: string;
  iconName: string;
  nameTextId: number;
  /** Existe um item do tipo Receita com este tblidx; sem ele ninguém aprende. */
  hasRecipeItem: boolean;
  results: (RecipeResultValue & ResolvedRef)[];
  materials: (RecipeMaterialValue & ResolvedRef)[];
};

export type RecipeListResponse = {
  recipes: RecipeEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sourceFile: string;
  sourceUpdatedAt: string;
  /** `count` é quantas receitas usam o tipo; na tabela do jogo só 0 e 6 aparecem. */
  recipeTypes: { value: number; label: string; count: number }[];
  maxMaterials: number;
  maxResults: number;
};

export type RecipeItemCandidate = {
  tblidx: number;
  name: string;
  iconName: string;
  nameTextId: number;
  hasRecipe: boolean;
};

export type RecipeDraft = {
  id: string;
  status: "draft" | "published";
  operation: "create" | "edit";
  tblidx: number;
  name: string;
  nameTextId: number;
  values: RecipeValues;
  baseValues: RecipeValues | null;
  changedFields: string[];
  administrator: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedBy?: string;
  publicationBackup?: string;
};

export type RecipePublishPreview = {
  draftId: string;
  operation: "create" | "edit";
  tblidx: number;
  name: string;
  rdfPath: string;
  changes: DropPublishChange[];
  warnings: string[];
  blockingIssues: string[];
  confirmationToken: string | null;
};

/* ===================== Ações do jogador ===================== */

export type ActionCatalogEntry = {
  tblidx: number;
  valid: boolean;
  actionType: number;
  actionTypeLabel: string;
  nameTextId: number;
  name: string;
  iconName: string;
  /** Índice em table_chat_command_data; é o comando de chat que dispara a ação. */
  chatCommand: number;
};

/* ===================== Itens de aposta ===================== */

export type GambleReward = {
  tblidx: number;
  name: string;
  iconName: string;
  rank: number;
  minQuantity: number;
  maxQuantity: number;
  /** Chance em porcento, já convertida de dwRate/10000. */
  chance: number;
  /** Aponta para um item que não existe em Table_Item_Data.rdf. */
  missing: boolean;
  /** byType diferente de eREWARD_TYPE_NORMAL_ITEM; o servidor recusa. */
  unsupportedType: boolean;
};

export type GambleRewardsResponse = {
  item: { tblidx: number; name: string; iconName: string; itemType: number };
  probabilityTblidx: number | null;
  probabilityName: string;
  /**
   * "one"  = o servidor entrega um só prêmio, sorteado entre os que passarem.
   * "each" = entrega todos os que passarem, então pode vir mais de um.
   * "none" = a caixa está quebrada e não devolve nada.
   */
  drawMode: "one" | "each" | "none";
  rewards: GambleReward[];
  warnings: string[];
};

/* ===================== Efeitos do sistema ===================== */

export type SystemEffectEntry = {
  tblidx: number;
  name: string;
  effectType: number;
  activeEffectType: number;
  effectCode: number;
  successEffectName: string;
};

/** Uma opção de campo numérico derivada dos valores que realmente existem na tabela. */
export type SkillFieldOption = {
  value: number;
  /** Quantas skills usam este valor hoje. */
  count: number;
  /** Nome de uma skill que usa o valor, para dar contexto ao número. */
  sample: string;
};

export type SkillFieldOptions = Record<string, SkillFieldOption[]>;

/* ===================== Skills do mob ===================== */

/** Uma posição dos arrays de skill dentro do registro do mob. */
export type MobSkillValue = {
  tblidx: number;
  /** byUse_Skill_Basis: 3 a 7. Fora disso o servidor descarta a skill. */
  basis: number;
  /** Porcentagem de LP, ou alcance quando a condição é "distância do alvo". */
  lp: number;
  /** Intervalo até o servidor considerar a skill de novo. */
  time: number;
};

export type MobSkillValues = { slots: MobSkillValue[] };

export type MobSkillSlot = MobSkillValue & {
  slot: number;
  name: string;
  iconName: string;
  requiredEp: number;
  /** Referenciada pelo mob mas ausente de Table_Skill_Data.rdf. */
  missing: boolean;
};

export type MobSkillsResponse = {
  mob: { tblidx: number; name: string; level: number; grade: number; mobType: number };
  slots: MobSkillSlot[];
  maxSlots: number;
  basisOptions: { value: number; label: string; note: string; lpMeaning: string }[];
  sourceFile: string;
  sourceUpdatedAt: string;
};

export type MobSkillDraft = {
  id: string;
  status: "draft" | "published";
  mobTblidx: number;
  mobName: string;
  values: MobSkillValues;
  baseValues: MobSkillValues;
  changedFields: string[];
  administrator: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedBy?: string;
  publicationBackup?: string;
};

export type MobSkillPublishPreview = {
  draftId: string;
  mobTblidx: number;
  mobName: string;
  rdfPath: string;
  changes: DropPublishChange[];
  warnings: string[];
  blockingIssues: string[];
  confirmationToken: string | null;
};

/* ===================== Edição de drops ===================== */

/** Uma posição do array: o item (numa bag) ou a bag (num grupo), com a probabilidade dela. */
export type DropSlot = { tblidx: number; probability: number };

export type DropDraftValues = {
  level: number;
  slots: DropSlot[];
  /** Só em bag. */
  enchantAble?: boolean;
  /** Só em grupo. */
  tryCount?: number;
  zenny?: number;
  superior?: number;
  excellent?: number;
  rare?: number;
  legendary?: number;
};

export type DropDraft = {
  id: string;
  status: "draft" | "published";
  target: "group" | "bag";
  tblidx: number;
  name: string;
  values: DropDraftValues;
  /** O RDF como estava quando o rascunho nasceu, para o diff da publicação. */
  baseValues: DropDraftValues;
  changedFields: string[];
  administrator: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedBy?: string;
  publicationBackup?: string;
};

export type DropPublishChange = {
  id: string;
  label: string;
  before: string;
  after: string;
};

/** Quem mais é afetado pela edição — bags são compartilhadas entre grupos. */
export type DropUsage = {
  groups: { tblidx: number; name: string }[];
  mobs: { tblidx: number; name: string; level: number }[];
  /** Algum grupo alcança mobs por regra de mundo ou tipo; o total não é enumerável. */
  reachesWholeRegion: boolean;
};

export type DropPublishPreview = {
  draftId: string;
  target: "group" | "bag";
  tblidx: number;
  name: string;
  rdfPath: string;
  changes: DropPublishChange[];
  warnings: string[];
  blockingIssues: string[];
  confirmationToken: string | null;
  usage: DropUsage;
};

/** O registro atual, como o editor precisa dele para abrir o formulário. */
export type DropRecordResponse = {
  target: "group" | "bag";
  tblidx: number;
  name: string;
  values: DropDraftValues;
  /** Nome e ícone de cada tblidx referenciado, para a tela não mostrar só números. */
  labels: { tblidx: number; name: string; iconName: string }[];
  usage: DropUsage;
  /** Campos que o editor mostra mas não grava, com o motivo. */
  readOnly: { label: string; value: string }[];
};

export type ItemDraftValue = string | number | boolean | number[];

export type ItemDraft = {
  id: string;
  status: "draft";
  itemType: number;
  profile: string;
  baseTblidx: number;
  baseName: string;
  newTblidx: number;
  name: string;
  values: Record<string, ItemDraftValue>;
  changedFields: string[];
  administrator: string;
  createdAt: string;
  updatedAt: string;
};

export type ItemDraftsResponse = {
  drafts: ItemDraft[];
};

export type SkillDraftValue = string | number | boolean | number[];

export type SkillDraft = {
  id: string;
  status: "draft" | "published";
  operation?: "create" | "edit";
  skillClass: number;
  characterClass: number;
  profile: string;
  baseTblidx: number;
  baseName: string;
  newTblidx: number;
  name: string;
  values: Record<string, SkillDraftValue>;
  changedFields: string[];
  administrator: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedBy?: string;
  publicationBackup?: string;
};

export type SkillDraftsResponse = {
  drafts: SkillDraft[];
};

/** Mudança de um lote, com o valor já traduzido para leitura (nome de efeito, classes, segundos). */
export type SkillBatchChange = SkillPublishChange & { beforeText: string; afterText: string };

/** Uma skill com edição pendente. Só o rascunho mais recente dela entra no lote. */
export type SkillBatchItem = {
  draftId: string;
  tblidx: number;
  name: string;
  iconName: string;
  administrator: string;
  updatedAt: string;
  changes: SkillBatchChange[];
  /** Algo impede esta skill de ir no lote; as demais seguem normalmente. */
  blockingIssues: string[];
  /** Versões antigas da mesma skill, descartadas junto quando o lote é aplicado. */
  supersededDraftIds: string[];
};

export type SkillBatchPreview = {
  items: SkillBatchItem[];
  readyCount: number;
  changeCount: number;
  rdfPath: string;
  defaultClientPackDirectory: string;
  /** Muda se qualquer rascunho pronto ou o RDF mudar; nulo quando nada pode ser aplicado. */
  token: string | null;
};

export type SkillBatchApplyResult = {
  applied: { tblidx: number; name: string; changes: number }[];
  skipped: { tblidx: number; name: string; reason: string }[];
  server: { rdfPath: string; backupPath: string } | null;
  client: { packFileName: string; packPath: string; backupPath: string | null } | null;
};

export type SkillBatchExportResult = {
  exportId: string;
  fileName: string;
  size: number;
  skills: number;
  changes: number;
  packFileName: string;
};

export type SkillPublishChange = {
  id: string;
  label: string;
  sourceField: string;
  before: SkillDraftValue;
  after: SkillDraftValue;
};

export type SkillPublishPreview = {
  draftId: string;
  tblidx: number;
  skillName: string;
  rdfPath: string;
  changes: SkillPublishChange[];
  warnings: string[];
  blockingIssues: string[];
  confirmationToken: string | null;
  /** Pasta pack do cliente sugerida no formulário de publicação. */
  defaultClientPackDirectory: string;
};

export type DeliveryEntry = {
  id: number;
  channel: "mail" | "cashshop";
  accountId: number;
  username: string | null;
  characterId: number | null;
  characterName: string | null;
  itemTblidx: number;
  itemName: string;
  quantity: number;
  requestedBy: string;
  status: string;
  deliveryId: number | null;
  itemInstanceId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  claimedByCharacterId: number | null;
};

export type DeliveriesResponse = {
  deliveries: DeliveryEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: { total: number; claimed: number; available: number; failed: number };
};

// ---------------------------------------------------------------- Battle Pass

/** 0 item, 1 título, 2 zeni, 3 cash da conta — mesma ordem de eBATTLEPASS_REWARD. */
export type BattlePassRewardType = 0 | 1 | 2 | 3;
/** 0 mob, 1 chefe, 2 quest, 3 TMQ, 4 dungeon (UD), 5 dia de login — eBATTLEPASS_OBJECTIVE. */
export type BattlePassObjective = 0 | 1 | 2 | 3 | 4 | 5;

export type BattlePassSeasonValues = {
  seasonId: number;
  name: string;
  /** Unix, em segundos. */
  startTime: number;
  endTime: number;
  maxLevel: number;
  xpPerLevel: number;
  /** 0 desliga a compra do Premium. */
  premiumPrice: number;
  dayOffsetMinutes: number;
};

export type BattlePassSeasonStatus = "live" | "scheduled" | "ended" | "inactive";

export type BattlePassSeasonSummary = BattlePassSeasonValues & {
  active: boolean;
  status: BattlePassSeasonStatus;
  missionCount: number;
  rewardCount: number;
  players: number;
  premiumPlayers: number;
  claims: number;
  /** Já tem jogador, resgate ou operação: curva de XP, objetivos e prêmios entregues ficam travados. */
  locked: boolean;
};

export type BattlePassRewardValues = {
  level: number;
  track: 0 | 1;
  rewardType: BattlePassRewardType;
  rewardId: number;
  quantity: number;
  titleDurationDays: number;
  featured: boolean;
};

export type BattlePassReward = BattlePassRewardValues & {
  itemName: string | null;
  iconName: string | null;
  claims: number;
  /** Já resgatada por alguém: o valor não pode mudar, só o destaque. */
  locked: boolean;
};

export type BattlePassMissionValues = {
  missionId: number;
  name: string;
  releaseDay: number;
  objective: BattlePassObjective;
  targetId: number;
  requiredAmount: number;
  experience: number;
  completionMobId: number;
  transformation: number;
  worldId: number;
  areaX: number;
  areaZ: number;
  areaRadius: number;
};

export type BattlePassMission = BattlePassMissionValues & {
  targetName: string | null;
  completionMobName: string | null;
  started: number;
  completed: number;
  released: boolean;
  /** Já liberada ou com progresso: só o nome pode mudar. */
  locked: boolean;
};

export type BattlePassSchema = {
  /** As 7 tabelas da migração existem. */
  ready: boolean;
  missingTables: string[];
  featured: boolean;
  missionConditions: boolean;
};

export type BattlePassOverview = {
  schema: BattlePassSchema;
  seasons: BattlePassSeasonSummary[];
  /** Mais de uma temporada com active=1 desliga o passe no servidor. */
  activeConflict: boolean;
  now: number;
};

export type BattlePassSeasonDetail = {
  schema: BattlePassSchema;
  season: BattlePassSeasonSummary;
  rewards: BattlePassReward[];
  missions: BattlePassMission[];
  levelDistribution: { level: number; players: number }[];
  /** O que faria o servidor recusar a configuração (e desligar o passe). */
  issues: string[];
  /** Pontos de atenção que não bloqueiam. */
  warnings: string[];
  now: number;
};

// ---------------------------------------------------------------- profissões (receitas das oficinas)

export type ProfessionRecipeItem = {
  tblidx: number;
  name: string;
  iconName: string;
  /** byMax_Stack do item; null quando o item não existe na Table_Item_Data. */
  maxStack: number | null;
};

export type ProfessionRecipe = {
  id: number;
  base: number;
  specialization: number;
  requiredLevel: number;
  durationSeconds: number;
  experience: number;
  output: ProfessionRecipeItem;
  outputCount: number;
  outputDurability: number;
  inputs: (ProfessionRecipeItem & { amount: number })[];
  enabled: boolean;
  /** A quantidade produzida tem de ser 1 (ferramenta com durabilidade e receitas de teste). */
  outputCountFixed: boolean;
  /** Lotes que a bancada deixa iniciar com os valores atuais. */
  batches: number[];
  /** Por que o QueryServer recusaria esta receita habilitada (vazio = aceita). */
  issues: string[];
  /** false: só existe no catálogo, entra no banco ao aplicar depois do build. */
  inDatabase: boolean;
  /** Está no miner-catalog.json: profissão, produto e materiais se mudam por lá (com build). */
  identityEditable: boolean;
  /** O que o catálogo diz e o banco ainda não tem (troca de produto, material ou profissão). */
  pending: ProfessionRecipeIdentity | null;
};

/** Profissão, produto e materiais: a parte da receita compilada no servidor e no cliente. */
export type ProfessionRecipeIdentity = {
  specialization: number;
  output: ProfessionRecipeItem;
  outputCount: number;
  outputDurability: number;
  inputs: (ProfessionRecipeItem & { amount: number })[];
};

export type ProfessionCatalogItemKind = "material" | "tool" | "tool_repair" | "equipment_repair";

export type ProfessionBuildPart = {
  label: string;
  /** Comando de build que atualiza esta parte. */
  command: string;
  files: string[];
  /** Data do executável mais antigo da parte (ISO); null se algum não existe. */
  builtAt: string | null;
  stale: boolean;
};

export type ProfessionCatalogInfo = {
  /** false: miner-catalog.json/NtlMinerRecipes.h não encontrados ao lado do servidor. */
  available: boolean;
  reason: string;
  /** sha256 do miner-catalog.json lido: a gravação recusa se ele mudou desde então. */
  version: string;
  /** Itens do catálogo e o tipo de cada um (material, ferramenta, kit). */
  items: { tblidx: number; kind: ProfessionCatalogItemKind; requiredLevel: number | null }[];
  /** Produto e materiais de cada receita do catálogo, para conferir repetição e ciclo no editor. */
  recipes: { id: number; output: number; inputs: number[] }[];
  /** Data de NtlMinerRecipes.h (ISO). */
  sourceChangedAt: string | null;
  build: ProfessionBuildPart[];
  buildNeeded: boolean;
  /** Receitas cujo catálogo ainda não está no banco. */
  pendingIds: number[];
  /** Build em dia e há receitas a aplicar no banco. */
  applyReady: boolean;
};

/** Profissão, produto e materiais pedidos no editor (vai para o miner-catalog.json). */
export type ProfessionCatalogDraft = {
  /** null = receita nova (o painel escolhe o próximo ID livre de 1001 a 1999). */
  id: number | null;
  specialization: number;
  outputItem: number;
  outputCount: number;
  inputs: { item: number; count: number }[];
  /** Só para receita nova; numa existente nível, tempo e XP continuam vindo do banco. */
  requiredLevel: number;
  durationSeconds: number;
  experience: number;
};

/** O que o painel deixa mudar; o resto é a identidade compilada no servidor e no cliente. */
export type ProfessionRecipeValues = {
  requiredLevel: number;
  durationSeconds: number;
  experience: number;
  outputCount: number;
  amounts: number[];
  enabled: boolean;
};

export type ProfessionRecipeOverview = {
  /** false: a tabela profession_forge_recipe não existe neste banco. */
  ready: boolean;
  recipes: ProfessionRecipe[];
  /** A Table_Item_Data foi lida (nomes, ícones e pilhas). */
  itemsLoaded: boolean;
  catalog: ProfessionCatalogInfo;
};
