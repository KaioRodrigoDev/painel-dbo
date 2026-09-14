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

export type AccountsResponse = {
  accounts: AccountSummary[];
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
