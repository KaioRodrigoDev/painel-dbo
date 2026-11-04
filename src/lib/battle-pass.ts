import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { getCharacterPool } from "@/lib/db";
import { loadItemCatalog } from "@/lib/item-catalog";
import { loadMobCatalog } from "@/lib/mob-catalog";
import type {
  BattlePassMission, BattlePassMissionValues, BattlePassOverview, BattlePassReward, BattlePassRewardValues,
  BattlePassSchema, BattlePassSeasonDetail, BattlePassSeasonStatus, BattlePassSeasonSummary, BattlePassSeasonValues,
} from "@/lib/types";

/**
 * Battle Pass no banco de personagens (mdbo_char).
 *
 * As regras abaixo espelham as do QueryServer (BattlePassRepository::ReadConfiguration) e
 * do cabeçalho compartilhado NtlBattlePass.h. Se o painel gravasse algo que o servidor
 * recusa, o passe inteiro seria desligado no canal no próximo `@bp reload` — por isso a
 * mesma validação roda aqui antes de qualquer gravação e antes de ativar uma temporada.
 *
 * Temporada com jogadores, resgates ou operações fica "travada", como manda o README da
 * ferramenta: não se muda curva de XP, objetivos de missão já liberadas nem prêmios já
 * resgatados. Dá para prorrogar o fim, renomear, mudar o preço do Premium, acrescentar
 * missões ainda não liberadas e prêmios em níveis sem resgate.
 */

const TABLES = [
  "battle_pass_season", "battle_pass_reward", "battle_pass_mission", "character_battle_pass",
  "character_battle_pass_mission", "character_battle_pass_claim", "battle_pass_operation",
];
const CONDITION_COLUMNS = ["transformation", "world_id", "area_x", "area_z", "area_radius"];

export const BATTLE_PASS_LIMITS = {
  maxLevel: 128,
  maxMissions: 64,
  maxXpPerLevel: 10_000_000,
  maxTitleId: 512,
  seasonNameBytes: 63,
  missionNameBytes: 95,
  maxTitleDays: 36500,
  maxCoordinate: 1_000_000,
  maxReleaseDay: 65535,
  dword: 0xffffffff,
};

const KILL_OBJECTIVES = new Set([0, 1]);
/** Tudo o que define a regra da missão; o nome fica de fora porque é só apresentação. */
const MISSION_RULE_FIELDS = ["releaseDay", "objective", "targetId", "requiredAmount", "experience", "completionMobId", "transformation", "worldId", "areaX", "areaZ", "areaRadius"] as const;
const VALID_TRANSFORMATIONS = new Set([0, 1, 2, 3, 4, 5]);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");
const isDword = (value: number) => Number.isInteger(value) && value >= 0 && value <= BATTLE_PASS_LIMITS.dword;

export class BattlePassError extends Error {}

// ---------------------------------------------------------------- esquema

export async function readBattlePassSchema(): Promise<BattlePassSchema> {
  const pool = getCharacterPool();
  const [tables] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [TABLES]);
  const present = new Set(tables.map((row) => String(row.name).toLowerCase()));
  const missingTables = TABLES.filter((table) => !present.has(table));
  if (missingTables.length) return { ready: false, missingTables, featured: false, missionConditions: false };

  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('battle_pass_reward','battle_pass_mission')");
  const has = (table: string, column: string) => columns.some((row) => String(row.tableName).toLowerCase() === table && String(row.columnName).toLowerCase() === column);
  return {
    ready: true,
    missingTables: [],
    featured: has("battle_pass_reward", "featured"),
    missionConditions: CONDITION_COLUMNS.every((column) => has("battle_pass_mission", column)),
  };
}

async function requireSchema() {
  const schema = await readBattlePassSchema();
  if (!schema.ready) throw new BattlePassError(`As tabelas do Battle Pass não existem neste banco (faltam: ${schema.missingTables.join(", ")}). Aplique a migração 20261013_battle_pass.sql primeiro.`);
  return schema;
}

// ---------------------------------------------------------------- leitura

const SEASON_SELECT = `
  SELECT s.season_id, s.name, s.start_time, s.end_time, s.max_level, s.xp_per_level, s.premium_price, s.day_offset_minutes, s.active,
    (SELECT COUNT(*) FROM battle_pass_mission m WHERE m.season_id = s.season_id) AS missions,
    (SELECT COUNT(*) FROM battle_pass_reward r WHERE r.season_id = s.season_id) AS rewards,
    (SELECT COUNT(*) FROM character_battle_pass c WHERE c.season_id = s.season_id) AS players,
    (SELECT COALESCE(SUM(c.premium), 0) FROM character_battle_pass c WHERE c.season_id = s.season_id) AS premium_players,
    (SELECT COUNT(*) FROM character_battle_pass_claim k WHERE k.season_id = s.season_id) AS claims,
    (SELECT COUNT(*) FROM battle_pass_operation o WHERE o.season_id = s.season_id) AS operations
  FROM battle_pass_season s`;

function seasonStatus(active: boolean, start: number, end: number, now: number): BattlePassSeasonStatus {
  if (!active) return "inactive";
  if (now < start) return "scheduled";
  if (now >= end) return "ended";
  return "live";
}

function toSeasonSummary(row: RowDataPacket, now: number): BattlePassSeasonSummary {
  const active = Number(row.active) === 1;
  const startTime = Number(row.start_time);
  const endTime = Number(row.end_time);
  const players = Number(row.players);
  const claims = Number(row.claims);
  return {
    seasonId: Number(row.season_id),
    name: String(row.name ?? ""),
    startTime,
    endTime,
    maxLevel: Number(row.max_level),
    xpPerLevel: Number(row.xp_per_level),
    premiumPrice: Number(row.premium_price),
    dayOffsetMinutes: Number(row.day_offset_minutes),
    active,
    status: seasonStatus(active, startTime, endTime, now),
    missionCount: Number(row.missions),
    rewardCount: Number(row.rewards),
    players,
    premiumPlayers: Number(row.premium_players),
    claims,
    locked: players > 0 || claims > 0 || Number(row.operations) > 0,
  };
}

export async function getBattlePassOverview(): Promise<BattlePassOverview> {
  const schema = await readBattlePassSchema();
  const now = nowSeconds();
  if (!schema.ready) return { schema, seasons: [], activeConflict: false, now };
  const [rows] = await getCharacterPool().query<RowDataPacket[]>(`${SEASON_SELECT} ORDER BY s.active DESC, s.start_time DESC, s.season_id DESC`);
  const seasons = rows.map((row) => toSeasonSummary(row, now));
  return { schema, seasons, activeConflict: seasons.filter((season) => season.active).length > 1, now };
}

async function loadNameCatalogs() {
  const [items, mobs] = await Promise.all([
    loadItemCatalog().then((catalog) => new Map(catalog.items.map((item) => [item.tblidx, item]))).catch(() => null),
    loadMobCatalog().then((catalog) => new Map(catalog.mobs.map((mob) => [mob.tblidx, mob]))).catch(() => null),
  ]);
  return { items, mobs };
}

export async function getBattlePassSeason(seasonId: number): Promise<BattlePassSeasonDetail> {
  const schema = await requireSchema();
  const pool = getCharacterPool();
  const now = nowSeconds();
  const [seasonRows] = await pool.query<RowDataPacket[]>(`${SEASON_SELECT} WHERE s.season_id = ?`, [seasonId]);
  if (!seasonRows.length) throw new BattlePassError(`A temporada ${seasonId} não existe.`);
  const season = toSeasonSummary(seasonRows[0], now);

  const [rewardRows] = await pool.query<RowDataPacket[]>(`
    SELECT r.level, r.track, r.reward_type, r.reward_id, r.quantity, r.title_duration_days, ${schema.featured ? "r.featured" : "0"} AS featured,
      (SELECT COUNT(*) FROM character_battle_pass_claim k WHERE k.season_id = r.season_id AND k.level = r.level AND k.track = r.track) AS claims
    FROM battle_pass_reward r WHERE r.season_id = ? ORDER BY r.level, r.track`, [seasonId]);
  const conditionColumns = schema.missionConditions ? "m.transformation, m.world_id, m.area_x, m.area_z, m.area_radius" : "0 AS transformation, 0 AS world_id, 0 AS area_x, 0 AS area_z, 0 AS area_radius";
  const [missionRows] = await pool.query<RowDataPacket[]>(`
    SELECT m.mission_id, m.name, m.release_day, m.objective, m.target_id, m.required_amount, m.experience, m.completion_mob_id, ${conditionColumns},
      (SELECT COUNT(*) FROM character_battle_pass_mission p WHERE p.mission_id = m.mission_id) AS started,
      (SELECT COUNT(*) FROM character_battle_pass_mission p WHERE p.mission_id = m.mission_id AND p.completed_at IS NOT NULL) AS completed
    FROM battle_pass_mission m WHERE m.season_id = ? ORDER BY m.release_day, m.mission_id`, [seasonId]);
  const [levelRows] = await pool.query<RowDataPacket[]>(
    "SELECT level, COUNT(*) AS players FROM character_battle_pass WHERE season_id = ? GROUP BY level ORDER BY level", [seasonId]);

  const { items, mobs } = await loadNameCatalogs();
  const rewards: BattlePassReward[] = rewardRows.map((row) => {
    const rewardType = Number(row.reward_type) as BattlePassReward["rewardType"];
    const rewardId = Number(row.reward_id);
    const item = rewardType === 0 ? items?.get(rewardId) : undefined;
    const claims = Number(row.claims);
    return {
      level: Number(row.level), track: Number(row.track) === 1 ? 1 : 0, rewardType, rewardId,
      quantity: Number(row.quantity), titleDurationDays: Number(row.title_duration_days), featured: Number(row.featured) === 1,
      itemName: item?.name ?? null, iconName: item?.iconName || null, claims, locked: claims > 0,
    };
  });
  const missions: BattlePassMission[] = missionRows.map((row) => {
    const values = missionFromRow(row);
    const started = Number(row.started);
    const released = now >= season.startTime + values.releaseDay * 86400;
    const mobName = (id: number) => (id ? mobs?.get(id)?.name ?? null : null);
    return {
      ...values,
      targetName: KILL_OBJECTIVES.has(values.objective) ? mobName(values.targetId) : null,
      completionMobName: values.objective === 4 ? mobName(values.completionMobId) : null,
      started,
      completed: Number(row.completed),
      released,
      locked: season.locked && (released || started > 0),
    };
  });

  const { issues, warnings } = validateConfiguration(season, rewards, missions, items ? (id) => items.has(id) : null);
  return {
    schema, season, rewards, missions, issues, warnings, now,
    levelDistribution: levelRows.map((row) => ({ level: Number(row.level), players: Number(row.players) })),
  };
}

function missionFromRow(row: RowDataPacket): BattlePassMissionValues {
  return {
    missionId: Number(row.mission_id), name: String(row.name ?? ""), releaseDay: Number(row.release_day),
    objective: Number(row.objective) as BattlePassMissionValues["objective"], targetId: Number(row.target_id),
    requiredAmount: Number(row.required_amount), experience: Number(row.experience), completionMobId: Number(row.completion_mob_id),
    transformation: Number(row.transformation), worldId: Number(row.world_id),
    areaX: Number(row.area_x), areaZ: Number(row.area_z), areaRadius: Number(row.area_radius),
  };
}

// ---------------------------------------------------------------- validação

export function validateSeasonValues(values: BattlePassSeasonValues) {
  const issues: string[] = [];
  if (!Number.isInteger(values.seasonId) || values.seasonId < 1 || values.seasonId > BATTLE_PASS_LIMITS.dword) issues.push("O ID da temporada precisa ser um inteiro positivo.");
  if (!values.name.trim()) issues.push("Dê um nome à temporada.");
  if (utf8Bytes(values.name) > BATTLE_PASS_LIMITS.seasonNameBytes) issues.push(`O nome da temporada passa de ${BATTLE_PASS_LIMITS.seasonNameBytes} bytes (acentos contam 2).`);
  if (!Number.isInteger(values.startTime) || !Number.isInteger(values.endTime) || values.startTime < 0) issues.push("Datas de início e fim inválidas.");
  else if (values.startTime >= values.endTime) issues.push("O fim da temporada precisa ser depois do início.");
  if (!Number.isInteger(values.maxLevel) || values.maxLevel < 1 || values.maxLevel > BATTLE_PASS_LIMITS.maxLevel) issues.push(`O nível máximo vai de 1 a ${BATTLE_PASS_LIMITS.maxLevel}.`);
  if (!Number.isInteger(values.xpPerLevel) || values.xpPerLevel < 1 || values.xpPerLevel > BATTLE_PASS_LIMITS.maxXpPerLevel) issues.push(`XP por nível vai de 1 a ${BATTLE_PASS_LIMITS.maxXpPerLevel.toLocaleString("pt-BR")}.`);
  if (!isDword(values.premiumPrice)) issues.push("Preço do Premium inválido.");
  if (!Number.isInteger(values.dayOffsetMinutes) || values.dayOffsetMinutes < -720 || values.dayOffsetMinutes > 840) issues.push("O fuso do dia de login vai de -720 a 840 minutos.");
  return issues;
}

export function validateRewardValues(values: BattlePassRewardValues, maxLevel: number, itemExists: ((id: number) => boolean) | null) {
  const issues: string[] = [];
  const where = `Recompensa do nível ${values.level} (${values.track ? "Premium" : "Grátis"})`;
  if (!Number.isInteger(values.level) || values.level < 1 || values.level > maxLevel) issues.push(`${where}: o nível precisa estar entre 1 e ${maxLevel}.`);
  if (values.track !== 0 && values.track !== 1) issues.push(`${where}: trilha inválida.`);
  if (!Number.isInteger(values.quantity) || values.quantity < 1 || !isDword(values.quantity)) issues.push(`${where}: a quantidade precisa ser pelo menos 1.`);
  if (!Number.isInteger(values.titleDurationDays) || values.titleDurationDays < 0 || values.titleDurationDays > BATTLE_PASS_LIMITS.maxTitleDays) issues.push(`${where}: duração do título fora de 0 a ${BATTLE_PASS_LIMITS.maxTitleDays} dias.`);
  if (values.rewardType === 0) {
    if (!values.rewardId || values.rewardId >= BATTLE_PASS_LIMITS.dword) issues.push(`${where}: escolha o item.`);
    else if (itemExists && !itemExists(values.rewardId)) issues.push(`${where}: o item ${values.rewardId} não existe no Table_Item_Data.rdf.`);
    if (values.titleDurationDays) issues.push(`${where}: item não tem duração de título.`);
  } else if (values.rewardType === 1) {
    if (!values.rewardId || values.rewardId > BATTLE_PASS_LIMITS.maxTitleId) issues.push(`${where}: o título vai de 1 a ${BATTLE_PASS_LIMITS.maxTitleId}.`);
    if (values.quantity !== 1) issues.push(`${where}: título é entregue em quantidade 1.`);
  } else if (values.rewardType === 2 || values.rewardType === 3) {
    if (values.rewardId !== 0) issues.push(`${where}: zeni e cash não usam ID.`);
    if (values.titleDurationDays) issues.push(`${where}: zeni e cash não têm duração.`);
  } else {
    issues.push(`${where}: tipo de recompensa inválido.`);
  }
  return issues;
}

export function validateMissionValues(values: BattlePassMissionValues, conditionsAvailable = true) {
  const issues: string[] = [];
  const where = `Missão ${values.missionId || "nova"}`;
  if (!Number.isInteger(values.missionId) || values.missionId < 1 || !isDword(values.missionId)) issues.push(`${where}: ID inválido.`);
  if (!values.name.trim()) issues.push(`${where}: dê um nome à missão.`);
  if (utf8Bytes(values.name) > BATTLE_PASS_LIMITS.missionNameBytes) issues.push(`${where}: o nome passa de ${BATTLE_PASS_LIMITS.missionNameBytes} bytes (acentos contam 2).`);
  if (!Number.isInteger(values.releaseDay) || values.releaseDay < 0 || values.releaseDay > BATTLE_PASS_LIMITS.maxReleaseDay) issues.push(`${where}: dia de liberação inválido.`);
  if (!Number.isInteger(values.objective) || values.objective < 0 || values.objective > 5) issues.push(`${where}: objetivo inválido.`);
  if (!isDword(values.targetId)) issues.push(`${where}: alvo inválido.`);
  if (!Number.isInteger(values.requiredAmount) || values.requiredAmount < 1 || !isDword(values.requiredAmount)) issues.push(`${where}: a quantidade exigida precisa ser pelo menos 1.`);
  if (!Number.isInteger(values.experience) || values.experience < 1 || !isDword(values.experience)) issues.push(`${where}: a XP precisa ser pelo menos 1.`);
  if (values.objective === 4) {
    if (!values.targetId) issues.push(`${where}: dungeon (UD) exige o mundo (target_id).`);
    if (!values.completionMobId || values.completionMobId >= BATTLE_PASS_LIMITS.dword) issues.push(`${where}: dungeon (UD) exige o chefe final.`);
  } else if (values.completionMobId !== 0) {
    issues.push(`${where}: chefe final só vale para dungeon (UD).`);
  }

  const hasConditions = values.transformation !== 0 || values.worldId !== 0 || values.areaRadius !== 0 || values.areaX !== 0 || values.areaZ !== 0;
  if (hasConditions && !conditionsAvailable) issues.push(`${where}: o banco ainda não tem a migração de condições (transformação/mapa/área).`);
  if (!VALID_TRANSFORMATIONS.has(values.transformation)) issues.push(`${where}: transformação inválida.`);
  if (!isDword(values.worldId) || values.worldId === BATTLE_PASS_LIMITS.dword) issues.push(`${where}: mapa inválido.`);
  for (const [label, value] of [["X", values.areaX], ["Z", values.areaZ]] as const) {
    if (!Number.isFinite(value) || Math.abs(value) > BATTLE_PASS_LIMITS.maxCoordinate) issues.push(`${where}: coordenada ${label} fora de ±1.000.000.`);
  }
  if (!Number.isFinite(values.areaRadius) || values.areaRadius < 0 || values.areaRadius > BATTLE_PASS_LIMITS.maxCoordinate) issues.push(`${where}: raio fora de 0 a 1.000.000.`);
  if (values.areaRadius === 0 && (values.areaX !== 0 || values.areaZ !== 0)) issues.push(`${where}: sem raio, o centro da área precisa ser 0,0.`);
  if (values.areaRadius > 0 && !values.worldId) issues.push(`${where}: área exige o mapa.`);
  if (!KILL_OBJECTIVES.has(values.objective) && hasConditions) issues.push(`${where}: transformação, mapa e área só valem para abater mobs ou chefes.`);
  return issues;
}

function validateConfiguration(
  season: BattlePassSeasonSummary,
  rewards: BattlePassRewardValues[],
  missions: BattlePassMissionValues[],
  itemExists: ((id: number) => boolean) | null,
) {
  const issues = validateSeasonValues(season);
  if (missions.length > BATTLE_PASS_LIMITS.maxMissions) issues.push(`A temporada tem ${missions.length} missões; o limite é ${BATTLE_PASS_LIMITS.maxMissions}.`);
  for (const reward of rewards) issues.push(...validateRewardValues(reward, season.maxLevel, itemExists));
  for (const mission of missions) issues.push(...validateMissionValues(mission));

  const warnings: string[] = [];
  const totalXp = missions.reduce((sum, mission) => sum + mission.experience, 0);
  const neededXp = (season.maxLevel - 1) * season.xpPerLevel;
  if (missions.length && totalXp < neededXp) {
    const reachable = Math.min(season.maxLevel, 1 + Math.floor(totalXp / season.xpPerLevel));
    warnings.push(`As missões somam ${totalXp.toLocaleString("pt-BR")} XP, mas chegar ao nível ${season.maxLevel} exige ${neededXp.toLocaleString("pt-BR")}. Quem fizer tudo para no nível ${reachable}.`);
  }
  const lastRelease = season.endTime - season.startTime;
  const lateMissions = missions.filter((mission) => mission.releaseDay * 86400 >= lastRelease);
  if (lateMissions.length) warnings.push(`${lateMissions.length} missão(ões) só liberariam depois do fim da temporada: ${lateMissions.map((mission) => mission.missionId).join(", ")}.`);
  const freeLevels = new Set(rewards.filter((reward) => reward.track === 0).map((reward) => reward.level));
  const emptyFree = Array.from({ length: season.maxLevel }, (_, index) => index + 1).filter((level) => !freeLevels.has(level));
  if (emptyFree.length && rewards.length) warnings.push(`${emptyFree.length} nível(is) sem recompensa grátis.`);
  if (!season.premiumPrice) warnings.push("Preço do Premium é 0: a compra fica desligada.");
  const accented = [season.name, ...missions.map((mission) => mission.name)].filter((name) => /[^\x20-\x7e]/.test(name));
  if (accented.length) warnings.push(`${accented.length} nome(s) com acento ou símbolo. O servidor não define charset na conexão do banco; confira no jogo se aparecem certos.`);
  if (season.active && season.status === "ended") warnings.push("A temporada continua marcada como ativa, mas já terminou: o passe fica indisponível no jogo.");
  return { issues, warnings };
}

// ---------------------------------------------------------------- gravação

async function withTransaction<T>(task: (connection: PoolConnection) => Promise<T>) {
  const connection = await getCharacterPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await task(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

/** Trava a linha da temporada e devolve o estado atual dela, incluindo se está "travada". */
async function lockSeason(connection: PoolConnection, seasonId: number) {
  const [locked] = await connection.query<RowDataPacket[]>("SELECT season_id FROM battle_pass_season WHERE season_id = ? FOR UPDATE", [seasonId]);
  if (!locked.length) throw new BattlePassError(`A temporada ${seasonId} não existe.`);
  const [rows] = await connection.query<RowDataPacket[]>(`${SEASON_SELECT} WHERE s.season_id = ?`, [seasonId]);
  return toSeasonSummary(rows[0], nowSeconds());
}

function assertValid(issues: string[]) {
  if (issues.length) throw new BattlePassError(issues.join(" "));
}

export async function createSeason(values: BattlePassSeasonValues) {
  await requireSchema();
  assertValid(validateSeasonValues(values));
  await withTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>("SELECT season_id FROM battle_pass_season WHERE season_id = ? FOR UPDATE", [values.seasonId]);
    if (existing.length) throw new BattlePassError(`Já existe uma temporada com o ID ${values.seasonId}.`);
    // Sempre nasce inativa: ligar é uma ação separada, depois de configurar missões e prêmios.
    await connection.query(
      "INSERT INTO battle_pass_season (season_id,name,start_time,end_time,max_level,xp_per_level,premium_price,day_offset_minutes,active) VALUES (?,?,?,?,?,?,?,?,0)",
      [values.seasonId, values.name.trim(), values.startTime, values.endTime, values.maxLevel, values.xpPerLevel, values.premiumPrice, values.dayOffsetMinutes]);
  });
}

export async function updateSeason(seasonId: number, values: BattlePassSeasonValues) {
  await requireSchema();
  assertValid(validateSeasonValues({ ...values, seasonId }));
  await withTransaction(async (connection) => {
    const current = await lockSeason(connection, seasonId);
    if (current.locked) {
      const changedLockedFields = [
        values.startTime !== current.startTime && "início",
        values.maxLevel !== current.maxLevel && "nível máximo",
        values.xpPerLevel !== current.xpPerLevel && "XP por nível",
        values.dayOffsetMinutes !== current.dayOffsetMinutes && "fuso do dia de login",
      ].filter(Boolean);
      if (changedLockedFields.length) throw new BattlePassError(`A temporada já tem jogadores: ${changedLockedFields.join(", ")} não pode(m) mudar. Dá para renomear, mudar o preço do Premium e prorrogar o fim.`);
      if (values.endTime < current.endTime) throw new BattlePassError("A temporada já tem jogadores: o fim só pode ser prorrogado, não antecipado.");
    }
    const [highest] = await connection.query<RowDataPacket[]>("SELECT COALESCE(MAX(level), 0) AS level FROM battle_pass_reward WHERE season_id = ?", [seasonId]);
    if (Number(highest[0].level) > values.maxLevel) throw new BattlePassError(`Há recompensas no nível ${highest[0].level}, acima do novo nível máximo ${values.maxLevel}. Remova-as antes.`);
    await connection.query(
      "UPDATE battle_pass_season SET name=?, start_time=?, end_time=?, max_level=?, xp_per_level=?, premium_price=?, day_offset_minutes=? WHERE season_id=?",
      [values.name.trim(), values.startTime, values.endTime, values.maxLevel, values.xpPerLevel, values.premiumPrice, values.dayOffsetMinutes, seasonId]);
  });
}

/** Liga uma temporada e desliga todas as outras, numa instrução só: o servidor exige exatamente uma ativa. */
export async function activateSeason(seasonId: number) {
  const detail = await getBattlePassSeason(seasonId);
  if (detail.issues.length) throw new BattlePassError(`O servidor recusaria esta configuração e o passe ficaria desligado: ${detail.issues.join(" ")}`);
  if (!detail.missions.length || !detail.rewards.length) throw new BattlePassError("Cadastre pelo menos uma missão e uma recompensa antes de ativar.");
  await withTransaction(async (connection) => {
    await lockSeason(connection, seasonId);
    await connection.query("UPDATE battle_pass_season SET active = (season_id = ?)", [seasonId]);
  });
}

export async function deactivateSeason(seasonId: number) {
  await requireSchema();
  await withTransaction(async (connection) => {
    await lockSeason(connection, seasonId);
    await connection.query("UPDATE battle_pass_season SET active = 0 WHERE season_id = ?", [seasonId]);
  });
}

export async function deleteSeason(seasonId: number) {
  await requireSchema();
  await withTransaction(async (connection) => {
    const current = await lockSeason(connection, seasonId);
    if (current.active) throw new BattlePassError("Desative a temporada antes de excluí-la.");
    if (current.locked) throw new BattlePassError("A temporada já tem jogadores, resgates ou operações e não pode ser excluída — isso apagaria o histórico deles.");
    await connection.query("DELETE p FROM character_battle_pass_mission p JOIN battle_pass_mission m ON m.mission_id = p.mission_id WHERE m.season_id = ?", [seasonId]);
    await connection.query("DELETE FROM battle_pass_mission WHERE season_id = ?", [seasonId]);
    await connection.query("DELETE FROM battle_pass_reward WHERE season_id = ?", [seasonId]);
    await connection.query("DELETE FROM battle_pass_season WHERE season_id = ?", [seasonId]);
  });
}

/** IDs de missão seguem o padrão já usado (temporada 900002 → 90000201...) quando estão livres. */
async function nextMissionIds(connection: PoolConnection, seasonId: number, count: number) {
  if (!count) return [];
  const preferred = Array.from({ length: count }, (_, index) => seasonId * 100 + index + 1);
  if (preferred[preferred.length - 1] <= BATTLE_PASS_LIMITS.dword) {
    const [taken] = await connection.query<RowDataPacket[]>("SELECT mission_id FROM battle_pass_mission WHERE mission_id IN (?)", [preferred]);
    if (!taken.length) return preferred;
  }
  const [max] = await connection.query<RowDataPacket[]>("SELECT COALESCE(MAX(mission_id), 0) AS id FROM battle_pass_mission");
  const start = Number(max[0].id) + 1;
  if (start + count - 1 > BATTLE_PASS_LIMITS.dword) throw new BattlePassError("Não há IDs de missão livres.");
  return Array.from({ length: count }, (_, index) => start + index);
}

export async function suggestMissionId(seasonId: number) {
  await requireSchema();
  const connection = await getCharacterPool().getConnection();
  try {
    const [count] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM battle_pass_mission WHERE season_id = ?", [seasonId]);
    const candidate = seasonId * 100 + Number(count[0].n) + 1;
    const [taken] = await connection.query<RowDataPacket[]>("SELECT mission_id FROM battle_pass_mission WHERE mission_id = ?", [candidate]);
    if (!taken.length && candidate <= BATTLE_PASS_LIMITS.dword) return candidate;
    return (await nextMissionIds(connection, seasonId, 1))[0];
  } finally {
    connection.release();
  }
}

/** Cria uma temporada nova, inativa, copiando curva, missões (com IDs novos) e recompensas de outra. */
export async function cloneSeason(sourceId: number, target: { seasonId: number; name: string; startTime: number }) {
  const schema = await requireSchema();
  const source = await getBattlePassSeason(sourceId);
  const duration = source.season.endTime - source.season.startTime;
  const values: BattlePassSeasonValues = {
    ...source.season, seasonId: target.seasonId, name: target.name, startTime: target.startTime, endTime: target.startTime + duration,
  };
  assertValid(validateSeasonValues(values));
  await withTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>("SELECT season_id FROM battle_pass_season WHERE season_id = ? FOR UPDATE", [values.seasonId]);
    if (existing.length) throw new BattlePassError(`Já existe uma temporada com o ID ${values.seasonId}.`);
    await connection.query(
      "INSERT INTO battle_pass_season (season_id,name,start_time,end_time,max_level,xp_per_level,premium_price,day_offset_minutes,active) VALUES (?,?,?,?,?,?,?,?,0)",
      [values.seasonId, values.name.trim(), values.startTime, values.endTime, values.maxLevel, values.xpPerLevel, values.premiumPrice, values.dayOffsetMinutes]);
    for (const reward of source.rewards) await insertReward(connection, values.seasonId, reward, schema);
    const ids = await nextMissionIds(connection, values.seasonId, source.missions.length);
    for (const [index, mission] of source.missions.entries()) await insertMission(connection, values.seasonId, { ...mission, missionId: ids[index] }, schema);
  });
}

async function insertReward(connection: PoolConnection, seasonId: number, reward: BattlePassRewardValues, schema: BattlePassSchema) {
  const columns = ["season_id", "level", "track", "reward_type", "reward_id", "quantity", "title_duration_days", ...(schema.featured ? ["featured"] : [])];
  const values = [seasonId, reward.level, reward.track, reward.rewardType, reward.rewardId, reward.quantity, reward.titleDurationDays, ...(schema.featured ? [reward.featured ? 1 : 0] : [])];
  await connection.query(`INSERT INTO battle_pass_reward (${columns.join(",")}) VALUES (?)`, [values]);
}

async function insertMission(connection: PoolConnection, seasonId: number, mission: BattlePassMissionValues, schema: BattlePassSchema) {
  const columns = ["mission_id", "season_id", "name", "release_day", "objective", "target_id", "required_amount", "experience", "completion_mob_id",
    ...(schema.missionConditions ? CONDITION_COLUMNS : [])];
  const values = [mission.missionId, seasonId, mission.name.trim(), mission.releaseDay, mission.objective, mission.targetId, mission.requiredAmount, mission.experience, mission.completionMobId,
    ...(schema.missionConditions ? [mission.transformation, mission.worldId, mission.areaX, mission.areaZ, mission.areaRadius] : [])];
  await connection.query(`INSERT INTO battle_pass_mission (${columns.join(",")}) VALUES (?)`, [values]);
}

export async function saveMission(seasonId: number, mission: BattlePassMissionValues, mode: "create" | "update") {
  const schema = await requireSchema();
  assertValid(validateMissionValues(mission, schema.missionConditions));
  await withTransaction(async (connection) => {
    const season = await lockSeason(connection, seasonId);
    const [existingRows] = await connection.query<RowDataPacket[]>("SELECT * FROM battle_pass_mission WHERE mission_id = ? FOR UPDATE", [mission.missionId]);
    const releaseMoment = season.startTime + mission.releaseDay * 86400;

    if (mode === "create") {
      if (existingRows.length) throw new BattlePassError(`O ID de missão ${mission.missionId} já está em uso${Number(existingRows[0].season_id) === seasonId ? " nesta temporada" : ` na temporada ${existingRows[0].season_id}`}.`);
      if (season.missionCount >= BATTLE_PASS_LIMITS.maxMissions) throw new BattlePassError(`A temporada já tem ${BATTLE_PASS_LIMITS.maxMissions} missões, o limite do servidor.`);
      if (season.locked && releaseMoment <= nowSeconds()) throw new BattlePassError("A temporada já tem jogadores: missões novas precisam liberar no futuro. Aumente o dia de liberação.");
      await insertMission(connection, seasonId, mission, schema);
      return;
    }

    if (!existingRows.length || Number(existingRows[0].season_id) !== seasonId) throw new BattlePassError(`A missão ${mission.missionId} não pertence a esta temporada.`);
    const current = missionFromRow({ ...existingRows[0], ...(schema.missionConditions ? {} : { transformation: 0, world_id: 0, area_x: 0, area_z: 0, area_radius: 0 }) } as RowDataPacket);
    const [progress] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM character_battle_pass_mission WHERE mission_id = ?", [mission.missionId]);
    const released = nowSeconds() >= season.startTime + current.releaseDay * 86400;
    const locked = season.locked && (released || Number(progress[0].n) > 0);
    if (locked) {
      const changedRules = MISSION_RULE_FIELDS.filter((field) => mission[field] !== current[field]);
      if (changedRules.length) throw new BattlePassError("Esta missão já foi liberada para jogadores: só o nome pode mudar. Para outro objetivo, crie uma missão nova com liberação futura.");
    } else if (season.locked && releaseMoment <= nowSeconds()) {
      throw new BattlePassError("A temporada já tem jogadores: esta missão precisa continuar liberando no futuro.");
    }
    await connection.query(
      `UPDATE battle_pass_mission SET name=?, release_day=?, objective=?, target_id=?, required_amount=?, experience=?, completion_mob_id=?${schema.missionConditions ? ", transformation=?, world_id=?, area_x=?, area_z=?, area_radius=?" : ""} WHERE mission_id=?`,
      [mission.name.trim(), mission.releaseDay, mission.objective, mission.targetId, mission.requiredAmount, mission.experience, mission.completionMobId,
        ...(schema.missionConditions ? [mission.transformation, mission.worldId, mission.areaX, mission.areaZ, mission.areaRadius] : []), mission.missionId]);
  });
}

export async function deleteMission(seasonId: number, missionId: number) {
  await requireSchema();
  await withTransaction(async (connection) => {
    const season = await lockSeason(connection, seasonId);
    const [rows] = await connection.query<RowDataPacket[]>("SELECT release_day, season_id FROM battle_pass_mission WHERE mission_id = ? FOR UPDATE", [missionId]);
    if (!rows.length || Number(rows[0].season_id) !== seasonId) throw new BattlePassError(`A missão ${missionId} não pertence a esta temporada.`);
    const [progress] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM character_battle_pass_mission WHERE mission_id = ?", [missionId]);
    if (Number(progress[0].n) > 0) throw new BattlePassError("Há jogadores com progresso nesta missão; ela não pode ser excluída.");
    if (season.locked && nowSeconds() >= season.startTime + Number(rows[0].release_day) * 86400) throw new BattlePassError("Esta missão já foi liberada para jogadores e não pode ser excluída.");
    await connection.query("DELETE FROM battle_pass_mission WHERE mission_id = ?", [missionId]);
  });
}

export async function saveReward(seasonId: number, reward: BattlePassRewardValues, original: { level: number; track: number } | null) {
  const schema = await requireSchema();
  if (reward.featured && !schema.featured) throw new BattlePassError("O banco ainda não tem a migração de destaque (20261014_battle_pass_featured.sql).");
  const items = reward.rewardType === 0 ? await loadItemCatalog().then((catalog) => new Set(catalog.items.map((item) => item.tblidx))).catch(() => null) : null;
  await withTransaction(async (connection) => {
    const season = await lockSeason(connection, seasonId);
    assertValid(validateRewardValues(reward, season.maxLevel, items ? (id) => items.has(id) : null));
    const claimsOn = async (level: number, track: number) => {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM character_battle_pass_claim WHERE season_id = ? AND level = ? AND track = ?", [seasonId, level, track]);
      return Number(rows[0].n);
    };
    const slotTaken = async (level: number, track: number) => {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT level FROM battle_pass_reward WHERE season_id = ? AND level = ? AND track = ? FOR UPDATE", [seasonId, level, track]);
      return rows.length > 0;
    };

    if (!original) {
      if (await slotTaken(reward.level, reward.track)) throw new BattlePassError(`O nível ${reward.level} já tem recompensa ${reward.track ? "Premium" : "grátis"}. Edite a existente.`);
      await insertReward(connection, seasonId, reward, schema);
      return;
    }

    const [currentRows] = await connection.query<RowDataPacket[]>(
      `SELECT reward_type, reward_id, quantity, title_duration_days FROM battle_pass_reward WHERE season_id = ? AND level = ? AND track = ? FOR UPDATE`, [seasonId, original.level, original.track]);
    if (!currentRows.length) throw new BattlePassError("Esta recompensa não existe mais.");
    const moved = original.level !== reward.level || original.track !== reward.track;
    const claims = await claimsOn(original.level, original.track);
    if (claims > 0) {
      const current = currentRows[0];
      const sameValue = !moved && Number(current.reward_type) === reward.rewardType && Number(current.reward_id) === reward.rewardId
        && Number(current.quantity) === reward.quantity && Number(current.title_duration_days) === reward.titleDurationDays;
      if (!sameValue) throw new BattlePassError(`Esta recompensa já foi resgatada ${claims} vez(es): o valor não pode mudar, só o destaque.`);
    }
    if (moved && await slotTaken(reward.level, reward.track)) throw new BattlePassError(`O nível ${reward.level} já tem recompensa ${reward.track ? "Premium" : "grátis"}.`);
    if (moved && season.locked && await claimsOn(reward.level, reward.track)) throw new BattlePassError("O destino já tem resgates registrados.");
    await connection.query("DELETE FROM battle_pass_reward WHERE season_id = ? AND level = ? AND track = ?", [seasonId, original.level, original.track]);
    await insertReward(connection, seasonId, reward, schema);
  });
}

export async function deleteReward(seasonId: number, level: number, track: number) {
  await requireSchema();
  await withTransaction(async (connection) => {
    await lockSeason(connection, seasonId);
    const [claims] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM character_battle_pass_claim WHERE season_id = ? AND level = ? AND track = ?", [seasonId, level, track]);
    if (Number(claims[0].n) > 0) throw new BattlePassError("Esta recompensa já foi resgatada e não pode ser removida.");
    await connection.query("DELETE FROM battle_pass_reward WHERE season_id = ? AND level = ? AND track = ?", [seasonId, level, track]);
  });
}
