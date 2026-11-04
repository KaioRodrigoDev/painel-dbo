"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CloneSeasonModal, describeReward, formatDateTime, ItemIcon, MissionFormModal, OBJECTIVES, resolveMissionName,
  REWARD_TYPES, RewardFormModal, SeasonFormModal, TRANSFORMATIONS,
} from "@/components/battle-pass-forms";
import { Icon } from "@/components/icons";
import type {
  BattlePassMission, BattlePassMissionValues, BattlePassOverview, BattlePassReward, BattlePassRewardValues,
  BattlePassSeasonDetail, BattlePassSeasonStatus, BattlePassSeasonSummary, BattlePassSeasonValues,
} from "@/lib/types";

const STATUS: Record<BattlePassSeasonStatus, { label: string; tone: string }> = {
  live: { label: "No ar", tone: "live" },
  scheduled: { label: "Agendada", tone: "scheduled" },
  ended: { label: "Encerrada (ainda ativa)", tone: "ended" },
  inactive: { label: "Desligada", tone: "inactive" },
};

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
const RELOAD_HINT = "Gravado no banco. No jogo, rode @bp reload em cada canal (ou reinicie o GameServer) para o passe recarregar.";

type Modal =
  | { kind: "season"; season: BattlePassSeasonSummary | null }
  | { kind: "clone"; season: BattlePassSeasonSummary }
  | { kind: "mission"; mission: BattlePassMission | null }
  | { kind: "reward"; reward: BattlePassReward | null; slot: { level: number; track: 0 | 1 } };

/**
 * Battle Pass: temporadas, missões e recompensas, gravadas direto nas tabelas que o
 * QueryServer lê. A tela mostra o fluxo inteiro (missões → XP → níveis → recompensas →
 * resgates) e as mesmas travas que o servidor exige numa temporada em andamento.
 */
export function BattlePassPanel() {
  const router = useRouter();
  const [overview, setOverview] = useState<BattlePassOverview | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [detail, setDetail] = useState<BattlePassSeasonDetail | null>(null);
  const [nextMissionId, setNextMissionId] = useState(0);
  const [tab, setTab] = useState<"flow" | "missions" | "rewards">("flow");
  const [modal, setModal] = useState<Modal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(async <T,>(url: string, body?: unknown): Promise<T> => {
    const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401) { router.push("/login"); throw new Error("Sessão expirada."); }
    const parsed = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(parsed.error ?? "A operação falhou.");
    return parsed;
  }, [router]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try { setOverview((await request<{ overview: BattlePassOverview }>("/api/battle-pass")).overview); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar o Battle Pass."); }
    finally { setLoading(false); }
  }, [request]);

  const loadSeason = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const body = await request<{ detail: BattlePassSeasonDetail; nextMissionId: number }>(`/api/battle-pass/${id}`);
      setDetail(body.detail); setNextMissionId(body.nextMissionId); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar a temporada."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { const timer = window.setTimeout(() => void loadOverview(), 0); return () => window.clearTimeout(timer); }, [loadOverview]);
  useEffect(() => {
    if (seasonId === null) return;
    const timer = window.setTimeout(() => void loadSeason(seasonId), 0);
    return () => window.clearTimeout(timer);
  }, [loadSeason, seasonId]);

  /** Ações sobre a temporada aberta; a resposta já traz a temporada atualizada. */
  async function seasonAction(body: Record<string, unknown>, success = RELOAD_HINT) {
    if (seasonId === null) return;
    const result = await request<{ detail?: BattlePassSeasonDetail; nextMissionId?: number; deleted?: boolean }>(`/api/battle-pass/${seasonId}`, body);
    if (result.deleted) { setSeasonId(null); setDetail(null); await loadOverview(); setNotice("Temporada excluída."); return; }
    if (result.detail) { setDetail(result.detail); setNextMissionId(result.nextMissionId ?? 0); }
    setNotice(success);
  }

  async function runConfirmed(message: string, body: Record<string, unknown>, success?: string) {
    if (!window.confirm(message)) return;
    setError("");
    try { await seasonAction(body, success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "A operação falhou."); }
  }

  const seasons = overview?.seasons ?? [];
  const suggestedSeasonId = seasons.reduce((max, season) => Math.max(max, season.seasonId), 0) + 1;
  const schema = detail?.schema ?? overview?.schema;

  return <div className="bpPanel">
    {error && <div className="errorBanner"><strong>Não foi possível concluir</strong><span>{error}</span></div>}
    {notice && <div className="successBanner bpNotice"><strong>Pronto</strong><span>{notice}</span><button type="button" className="skillRevertAll" onClick={() => setNotice("")}>ok</button></div>}

    {schema && !schema.ready && <div className="errorBanner"><strong>As tabelas do Battle Pass não existem neste banco</strong>
      <span>Faltam: {schema.missingTables.join(", ")}. Faça backup do mdbo_char e aplique DboServer/Database/migrations/20261013_battle_pass.sql.</span></div>}
    {schema?.ready && (!schema.featured || !schema.missionConditions) && <div className="errorBanner subtle"><strong>Migrações pendentes</strong>
      <span>{[!schema.featured && "20261014_battle_pass_featured.sql (recompensas em destaque)", !schema.missionConditions && "20261014_battle_pass_mission_conditions.sql (transformação, mapa e área)"].filter(Boolean).join(" e ")}. Os campos correspondentes ficam desligados até lá.</span></div>}

    {seasonId === null
      ? <SeasonList overview={overview} loading={loading} onOpen={(id) => { setSeasonId(id); setTab("flow"); setNotice(""); }} onCreate={() => setModal({ kind: "season", season: null })} />
      : !detail ? <div className="loadingState"><span className="spinner" /> Lendo a temporada...</div>
      : <SeasonView
          detail={detail}
          tab={tab}
          onTab={setTab}
          onBack={() => { setSeasonId(null); setDetail(null); setNotice(""); void loadOverview(); }}
          onEdit={() => setModal({ kind: "season", season: detail.season })}
          onClone={() => setModal({ kind: "clone", season: detail.season })}
          onActivate={() => {
            const outra = seasons.find((season) => season.active && season.seasonId !== detail.season.seasonId);
            void runConfirmed(`Ativar "${detail.season.name}"?${outra ? `\n\nIsso DESLIGA "${outra.name}", que está ativa agora${outra.players ? ` com ${outra.players} jogador(es)` : ""}.` : ""}\n\nO servidor só carrega uma temporada ativa. Depois rode @bp reload em cada canal.`, { action: "activate" });
          }}
          onDeactivate={() => void runConfirmed(`Desligar "${detail.season.name}"? Sem temporada ativa, o Battle Pass some do jogo após o @bp reload.`, { action: "deactivate" })}
          onDelete={() => void runConfirmed(`Excluir a temporada "${detail.season.name}" com ${detail.missions.length} missões e ${detail.rewards.length} recompensas? Não dá para desfazer.`, { action: "delete" })}
          onMission={(mission) => setModal({ kind: "mission", mission })}
          onDeleteMission={(mission) => void runConfirmed(`Excluir a missão "${resolveMissionName(mission)}" (#${mission.missionId})?`, { action: "deleteMission", missionId: mission.missionId })}
          onReward={(reward, slot) => setModal({ kind: "reward", reward, slot })}
          onDeleteReward={(reward) => void runConfirmed(`Remover a recompensa ${reward.track ? "Premium" : "grátis"} do nível ${reward.level} (${describeReward(reward)})?`, { action: "deleteReward", level: reward.level, track: reward.track })}
        />}

    {modal?.kind === "season" && <SeasonFormModal season={modal.season} suggestedId={suggestedSeasonId} onClose={() => setModal(null)} onSubmit={async (values: BattlePassSeasonValues) => {
      if (modal.season) await seasonAction({ action: "update", values });
      else {
        const created = await request<{ seasonId: number }>("/api/battle-pass", { action: "create", values });
        await loadOverview(); setSeasonId(created.seasonId); setTab("missions");
        setNotice("Temporada criada (desligada). Cadastre missões e recompensas e depois ative.");
      }
      setModal(null);
    }} />}
    {modal?.kind === "clone" && <CloneSeasonModal source={modal.season} suggestedId={suggestedSeasonId} onClose={() => setModal(null)} onSubmit={async (values) => {
      const created = await request<{ seasonId: number }>("/api/battle-pass", { action: "clone", sourceSeasonId: modal.season.seasonId, ...values });
      setModal(null); setDetail(null); await loadOverview(); setSeasonId(created.seasonId); setTab("flow");
      setNotice("Cópia criada (desligada). Revise datas, missões e recompensas antes de ativar.");
    }} />}
    {modal?.kind === "mission" && detail && <MissionFormModal mission={modal.mission} suggestedId={nextMissionId} season={detail.season} conditionsAvailable={detail.schema.missionConditions}
      onClose={() => setModal(null)} onSubmit={async (mission: BattlePassMissionValues, mode) => { await seasonAction({ action: "saveMission", mode, mission }); setModal(null); }} />}
    {modal?.kind === "reward" && detail && <RewardFormModal reward={modal.reward} slot={modal.slot} season={detail.season} featuredAvailable={detail.schema.featured}
      onClose={() => setModal(null)} onSubmit={async (reward: BattlePassRewardValues, original) => { await seasonAction({ action: "saveReward", reward, original }); setModal(null); }} />}
  </div>;
}

// ---------------------------------------------------------------- lista de temporadas

function StatusChip({ status }: { status: BattlePassSeasonStatus }) {
  return <span className={`bpStatus ${STATUS[status].tone}`}>{status === "live" && <i />}{STATUS[status].label}</span>;
}

function SeasonList({ overview, loading, onOpen, onCreate }: { overview: BattlePassOverview | null; loading: boolean; onOpen: (id: number) => void; onCreate: () => void }) {
  const seasons = overview?.seasons ?? [];
  const now = overview?.now ?? 0;
  return <>
    <div className="bpToolbar">
      <div><strong>Temporadas</strong><span>O servidor carrega exatamente uma temporada ativa. Ative, desligue ou clone a partir daqui.</span></div>
      <button type="button" className="primaryButton compact" disabled={!overview?.schema.ready} onClick={onCreate}><Icon name="plus" size={16} /> Nova temporada</button>
    </div>
    {overview?.activeConflict && <div className="errorBanner"><strong>Mais de uma temporada ativa</strong><span>Com duas ou mais marcadas como ativas, o servidor recusa a configuração e o Battle Pass fica desligado. Abra uma delas e use Ativar: as outras são desligadas na mesma operação.</span></div>}
    {loading && !overview ? <div className="loadingState"><span className="spinner" /> Lendo o Battle Pass...</div>
      : !seasons.length ? <div className="draftEmptyState">{!overview ? "Sem dados: o banco de personagens não respondeu." : overview.schema.ready ? "Nenhuma temporada ainda. Crie a primeira." : "Aplique a migração para começar."}</div>
      : <div className="bpSeasonGrid">{seasons.map((season) => {
          const total = season.endTime - season.startTime;
          const elapsed = Math.min(1, Math.max(0, (now - season.startTime) / total));
          return <button key={season.seasonId} type="button" className={`bpSeasonCard ${STATUS[season.status].tone}`} onClick={() => onOpen(season.seasonId)}>
            <header><StatusChip status={season.status} /><code>#{season.seasonId}</code></header>
            <strong>{season.name}</strong>
            <span className="bpSeasonDates"><Icon name="calendar" size={13} />{formatDateTime(season.startTime)} → {formatDateTime(season.endTime)}</span>
            <div className="bpTimeBar"><i style={{ width: `${elapsed * 100}%` }} /></div>
            <dl>
              <div><dt>Jogadores</dt><dd>{formatNumber(season.players)}</dd></div>
              <div><dt>Premium</dt><dd>{formatNumber(season.premiumPlayers)}</dd></div>
              <div><dt>Missões</dt><dd>{season.missionCount}</dd></div>
              <div><dt>Recompensas</dt><dd>{season.rewardCount}</dd></div>
            </dl>
          </button>;
        })}</div>}
  </>;
}

// ---------------------------------------------------------------- temporada aberta

function SeasonView(props: {
  detail: BattlePassSeasonDetail; tab: "flow" | "missions" | "rewards"; onTab: (tab: "flow" | "missions" | "rewards") => void;
  onBack: () => void; onEdit: () => void; onClone: () => void; onActivate: () => void; onDeactivate: () => void; onDelete: () => void;
  onMission: (mission: BattlePassMission | null) => void; onDeleteMission: (mission: BattlePassMission) => void;
  onReward: (reward: BattlePassReward | null, slot: { level: number; track: 0 | 1 }) => void; onDeleteReward: (reward: BattlePassReward) => void;
}) {
  const { detail } = props;
  const { season } = detail;
  const totalXp = detail.missions.reduce((sum, mission) => sum + mission.experience, 0);
  const neededXp = (season.maxLevel - 1) * season.xpPerLevel;
  const daysLeft = Math.ceil((season.endTime - detail.now) / 86400);

  return <>
    <div className="bpSeasonHeader">
      <button type="button" className="iconButton" onClick={props.onBack} title="Voltar às temporadas" aria-label="Voltar às temporadas"><Icon name="back" /></button>
      <div className="bpSeasonTitle">
        <div><StatusChip status={season.status} /><code>#{season.seasonId}</code>{season.locked && <span className="bpLockedChip" title="Já tem jogadores, resgates ou operações"><Icon name="lock" size={12} /> em andamento</span>}</div>
        <h2>{season.name}</h2>
        <span>{formatDateTime(season.startTime)} → {formatDateTime(season.endTime)}{season.status === "live" && ` · faltam ${daysLeft} dia${daysLeft === 1 ? "" : "s"}`}</span>
      </div>
      <div className="bpSeasonActions">
        <button type="button" className="catalogClearButton" onClick={props.onEdit}><Icon name="pencil" size={14} /> Editar</button>
        <button type="button" className="catalogClearButton" onClick={props.onClone}><Icon name="copy" size={14} /> Clonar</button>
        {season.active
          ? <button type="button" className="skillBatchDiscard" onClick={props.onDeactivate}><Icon name="power" size={14} /> Desligar</button>
          : <button type="button" className="primaryButton compact" disabled={detail.issues.length > 0} title={detail.issues.length ? "Corrija os problemas antes de ativar" : undefined} onClick={props.onActivate}><Icon name="power" size={14} /> Ativar</button>}
        {!season.active && !season.locked && <button type="button" className="iconButton" title="Excluir temporada" aria-label="Excluir temporada" onClick={props.onDelete}><Icon name="trash" size={16} /></button>}
      </div>
    </div>

    {detail.issues.length > 0 && <div className="errorBanner"><strong>O servidor recusaria esta configuração{season.active ? " — o Battle Pass está desligado no jogo" : ""}</strong>{detail.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
    {detail.warnings.length > 0 && <div className="publishWarnings">{detail.warnings.map((warning) => <span key={warning}>⚠ {warning}</span>)}</div>}

    <div className="bpStats">
      <div><small>Jogadores</small><strong>{formatNumber(season.players)}</strong></div>
      <div><small>Premium</small><strong>{formatNumber(season.premiumPlayers)}</strong><em>{percent(season.premiumPlayers, season.players)}% · {season.premiumPrice ? `${formatNumber(season.premiumPrice)} cash` : "compra desligada"}</em></div>
      <div><small>Resgates</small><strong>{formatNumber(season.claims)}</strong></div>
      <div className="wide"><small>XP das missões × XP até o nível {season.maxLevel}</small>
        <strong className={totalXp >= neededXp ? "ok" : "short"}>{formatNumber(totalXp)} <span>/ {formatNumber(neededXp)}</span></strong>
        <div className="bpXpBar"><i style={{ width: `${Math.min(100, percent(totalXp, neededXp))}%` }} /></div></div>
    </div>

    <nav className="bpTabs" aria-label="Partes da temporada">
      {([["flow", "Fluxo", "ticket"], ["missions", `Missões (${detail.missions.length}/64)`, "swords"], ["rewards", `Recompensas (${detail.rewards.length})`, "gift"]] as const).map(([key, label, icon]) =>
        <button key={key} type="button" className={props.tab === key ? "active" : ""} onClick={() => props.onTab(key)}><Icon name={icon} size={15} />{label}</button>)}
    </nav>

    {props.tab === "flow" && <FlowView detail={detail} totalXp={totalXp} neededXp={neededXp} onTab={props.onTab} />}
    {props.tab === "missions" && <MissionsView detail={detail} onMission={props.onMission} onDeleteMission={props.onDeleteMission} />}
    {props.tab === "rewards" && <RewardTrack detail={detail} onReward={props.onReward} onDeleteReward={props.onDeleteReward} />}
  </>;
}

// ---------------------------------------------------------------- fluxo

function FlowView({ detail, totalXp, neededXp, onTab }: { detail: BattlePassSeasonDetail; totalXp: number; neededXp: number; onTab: (tab: "missions" | "rewards") => void }) {
  const { season } = detail;
  const free = detail.rewards.filter((reward) => reward.track === 0).length;
  const premium = detail.rewards.length - free;
  const duration = season.endTime - season.startTime;
  const releases = useMemo(() => {
    const groups = new Map<number, BattlePassMission[]>();
    for (const mission of detail.missions) groups.set(mission.releaseDay, [...(groups.get(mission.releaseDay) ?? []), mission]);
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [detail.missions]);
  const nowPosition = Math.min(1, Math.max(0, (detail.now - season.startTime) / duration));
  const maxPlayers = Math.max(1, ...detail.levelDistribution.map((entry) => entry.players));

  return <div className="bpFlow">
    <section className="bpFlowSteps" aria-label="Como o passe funciona">
      <button type="button" onClick={() => onTab("missions")}><Icon name="swords" size={20} /><small>1 · Missões</small><strong>{detail.missions.length}</strong><span>somam {formatNumber(totalXp)} XP</span></button>
      <b aria-hidden="true">→</b>
      <div><Icon name="ticket" size={20} /><small>2 · Níveis</small><strong>{season.maxLevel}</strong><span>{formatNumber(season.xpPerLevel)} XP cada · {formatNumber(neededXp)} no total</span></div>
      <b aria-hidden="true">→</b>
      <button type="button" onClick={() => onTab("rewards")}><Icon name="gift" size={20} /><small>3 · Recompensas</small><strong>{detail.rewards.length}</strong><span>{free} grátis · {premium} Premium</span></button>
      <b aria-hidden="true">→</b>
      <div><Icon name="star" size={20} /><small>4 · Resgates</small><strong>{formatNumber(season.claims)}</strong><span>{formatNumber(season.premiumPlayers)} com Premium</span></div>
    </section>

    <section className="bpSection">
      <header><h3>Linha do tempo</h3><span>Missões liberam em períodos de 24 h contados do início.</span></header>
      <div className="bpTimeline">
        <div className="bpTimelineBar">
          {detail.now >= season.startTime && detail.now < season.endTime && <i className="bpNow" style={{ left: `${nowPosition * 100}%` }} title="Agora" />}
          {releases.map(([day, missions]) => {
            const position = Math.min(1, (day * 86400) / duration);
            const xp = missions.reduce((sum, mission) => sum + mission.experience, 0);
            return <span key={day} className={`bpRelease${day * 86400 >= duration ? " late" : ""}`} style={{ left: `${position * 100}%` }}
              title={`Dia ${day}: ${missions.length} missão(ões), ${formatNumber(xp)} XP`}><b>{missions.length}</b></span>;
          })}
        </div>
        <div className="bpTimelineLabels"><span>{formatDateTime(season.startTime)}</span><span>{formatDateTime(season.endTime)}</span></div>
        <ul className="bpReleaseList">{releases.map(([day, missions]) => <li key={day}>
          <strong>{day === 0 ? "No início" : `Dia ${day}`}</strong>
          <span>{formatDateTime(season.startTime + day * 86400)}</span>
          <em>{missions.length} missão(ões) · {formatNumber(missions.reduce((sum, mission) => sum + mission.experience, 0))} XP</em>
        </li>)}</ul>
      </div>
    </section>

    <section className="bpSection">
      <header><h3>Onde os jogadores estão</h3><span>Quantos personagens em cada nível agora.</span></header>
      {detail.levelDistribution.length === 0 ? <p className="muted">Ninguém começou esta temporada ainda.</p>
        : <div className="bpLevelChart">{Array.from({ length: season.maxLevel }, (_, index) => index + 1).map((level) => {
            const players = detail.levelDistribution.find((entry) => entry.level === level)?.players ?? 0;
            return <div key={level} title={`Nível ${level}: ${players} jogador(es)`}><i style={{ height: `${(players / maxPlayers) * 100}%` }} /><small>{level}</small></div>;
          })}</div>}
    </section>
  </div>;
}

// ---------------------------------------------------------------- missões

function missionTarget(mission: BattlePassMission) {
  const objective = OBJECTIVES[mission.objective];
  if (mission.objective === 0 || mission.objective === 1) return mission.targetId ? mission.targetName ?? `Mob #${mission.targetId}` : objective.anyLabel;
  if (mission.objective === 2) return mission.targetId ? `Quest #${mission.targetId}` : objective.anyLabel;
  if (mission.objective === 3) return mission.targetId ? `TMQ #${mission.targetId}` : objective.anyLabel;
  if (mission.objective === 4) return `Mundo #${mission.targetId} · chefe ${mission.completionMobName ?? `#${mission.completionMobId}`}`;
  return "dias diferentes";
}

function MissionsView({ detail, onMission, onDeleteMission }: { detail: BattlePassSeasonDetail; onMission: (mission: BattlePassMission | null) => void; onDeleteMission: (mission: BattlePassMission) => void }) {
  const { season } = detail;
  const groups = useMemo(() => {
    const map = new Map<number, BattlePassMission[]>();
    for (const mission of detail.missions) map.set(mission.releaseDay, [...(map.get(mission.releaseDay) ?? []), mission]);
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [detail.missions]);

  return <div className="bpMissions">
    <div className="bpToolbar">
      <div><strong>{detail.missions.length} de 64 missões</strong><span>Cada missão concluída dá XP de passe uma vez. Liberadas por dia, a partir do início.</span></div>
      <button type="button" className="primaryButton compact" disabled={detail.missions.length >= 64} onClick={() => onMission(null)}><Icon name="plus" size={16} /> Nova missão</button>
    </div>
    {!groups.length && <div className="draftEmptyState">Nenhuma missão. Sem missões, ninguém ganha XP de passe.</div>}
    {groups.map(([day, missions]) => <section key={day} className="bpMissionGroup">
      <header><strong>{day === 0 ? "No início" : `Dia ${day}`}</strong><span>{formatDateTime(season.startTime + day * 86400)} · {missions[0].released ? "liberadas" : "ainda não liberadas"}</span></header>
      <div className="bpMissionGrid">{missions.map((mission) => {
        const objective = OBJECTIVES[mission.objective];
        const transformation = TRANSFORMATIONS.find((entry) => entry.value === mission.transformation);
        return <article key={mission.missionId} className={`bpMission obj${mission.objective}${mission.released ? "" : " pending"}`}>
          <span className="bpMissionIcon"><Icon name={objective.icon} size={18} /></span>
          <div className="bpMissionBody">
            <strong title={mission.name}>{resolveMissionName(mission)}</strong>
            <span>{objective.label} · {missionTarget(mission)}</span>
            <div className="bpMissionChips">
              <b>Meta {formatNumber(mission.requiredAmount)}</b><b className="xp">+{formatNumber(mission.experience)} XP</b>
              {mission.transformation > 0 && <b className="cond">{transformation?.name ?? `Transformação ${mission.transformation}`}</b>}
              {mission.worldId > 0 && <b className="cond">Mapa #{mission.worldId}</b>}
              {mission.areaRadius > 0 && <b className="cond">Área r={formatNumber(mission.areaRadius)}</b>}
            </div>
            <small>#{mission.missionId} · {formatNumber(mission.started)} começaram · {formatNumber(mission.completed)} concluíram</small>
          </div>
          <div className="bpMissionActions">
            {mission.locked && <span className="bpLockIcon" title="Já liberada para jogadores: só o nome pode mudar"><Icon name="lock" size={14} /></span>}
            <button type="button" className="skillCardButton edit" title="Editar missão" aria-label={`Editar ${mission.name}`} onClick={() => onMission(mission)}><Icon name="pencil" size={14} /></button>
            {!mission.locked && mission.started === 0 && <button type="button" className="skillCardButton" title="Excluir missão" aria-label={`Excluir ${mission.name}`} onClick={() => onDeleteMission(mission)}><Icon name="trash" size={14} /></button>}
          </div>
        </article>;
      })}</div>
    </section>)}
  </div>;
}

// ---------------------------------------------------------------- recompensas

function RewardSlot({ reward, track, level, onOpen, onDelete }: { reward: BattlePassReward | undefined; track: 0 | 1; level: number; onOpen: () => void; onDelete: () => void }) {
  if (!reward) return <button type="button" className={`bpRewardSlot empty ${track ? "premium" : "free"}`} onClick={onOpen} title={`Adicionar recompensa ${track ? "Premium" : "grátis"} ao nível ${level}`}><Icon name="plus" size={16} /></button>;
  const type = REWARD_TYPES[reward.rewardType];
  return <div className={`bpRewardSlot ${track ? "premium" : "free"}${reward.featured ? " featured" : ""}`}>
    <button type="button" className="bpRewardMain" onClick={onOpen} title={`${describeReward(reward)} — clique para editar`}>
      {reward.rewardType === 0 ? <ItemIcon iconName={reward.iconName} size={34} /> : <span className={`bpRewardTypeIcon t${reward.rewardType}`}><Icon name={type.icon} size={18} /></span>}
      <span>{describeReward(reward)}</span>
    </button>
    <footer>
      {reward.featured && <Icon name="star" size={12} />}
      {reward.claims > 0 && <em title="Resgates">{formatNumber(reward.claims)}×</em>}
      {reward.locked ? <Icon name="lock" size={12} /> : <button type="button" className="bpRewardRemove" onClick={onDelete} title="Remover" aria-label="Remover recompensa"><Icon name="trash" size={12} /></button>}
    </footer>
  </div>;
}

function RewardTrack({ detail, onReward, onDeleteReward }: { detail: BattlePassSeasonDetail; onReward: (reward: BattlePassReward | null, slot: { level: number; track: 0 | 1 }) => void; onDeleteReward: (reward: BattlePassReward) => void }) {
  const { season } = detail;
  const bySlot = new Map(detail.rewards.map((reward) => [`${reward.level}:${reward.track}`, reward]));
  const players = new Map(detail.levelDistribution.map((entry) => [entry.level, entry.players]));
  return <div className="bpRewards">
    <div className="bpToolbar">
      <div><strong>Trilha de recompensas</strong><span>Como no jogo: cada nível tem um prêmio grátis (em cima) e um Premium (embaixo). Clique num espaço para criar ou editar.</span></div>
    </div>
    <div className="bpTrackScroll">
      <div className="bpTrack" style={{ gridTemplateColumns: `90px repeat(${season.maxLevel}, 132px)` }}>
        <div className="bpTrackLabel">Nível</div>
        {Array.from({ length: season.maxLevel }, (_, index) => <div key={index} className="bpTrackLevel"><strong>{index + 1}</strong>{(players.get(index + 1) ?? 0) > 0 && <small>{players.get(index + 1)} aqui</small>}</div>)}
        <div className="bpTrackLabel free">Grátis</div>
        {Array.from({ length: season.maxLevel }, (_, index) => <RewardSlot key={`f${index}`} track={0} level={index + 1} reward={bySlot.get(`${index + 1}:0`)}
          onOpen={() => onReward(bySlot.get(`${index + 1}:0`) ?? null, { level: index + 1, track: 0 })} onDelete={() => { const reward = bySlot.get(`${index + 1}:0`); if (reward) onDeleteReward(reward); }} />)}
        <div className="bpTrackLabel premium">Premium</div>
        {Array.from({ length: season.maxLevel }, (_, index) => <RewardSlot key={`p${index}`} track={1} level={index + 1} reward={bySlot.get(`${index + 1}:1`)}
          onOpen={() => onReward(bySlot.get(`${index + 1}:1`) ?? null, { level: index + 1, track: 1 })} onDelete={() => { const reward = bySlot.get(`${index + 1}:1`); if (reward) onDeleteReward(reward); }} />)}
      </div>
    </div>
  </div>;
}
