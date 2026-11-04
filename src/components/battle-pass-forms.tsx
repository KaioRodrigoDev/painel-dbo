"use client";

import Image from "next/image";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Icon, type IconName } from "@/components/icons";
import type {
  BattlePassMission, BattlePassMissionValues, BattlePassObjective, BattlePassReward, BattlePassRewardType,
  BattlePassRewardValues, BattlePassSeasonSummary, BattlePassSeasonValues, ItemCatalogResponse, MobCatalogResponse,
} from "@/lib/types";

// ---------------------------------------------------------------- vocabulário

export const OBJECTIVES: Record<BattlePassObjective, { label: string; icon: IconName; target: string | null; anyLabel: string }> = {
  0: { label: "Derrotar mobs", icon: "swords", target: "Mob", anyLabel: "qualquer mob" },
  1: { label: "Derrotar chefes", icon: "crown", target: "Chefe", anyLabel: "qualquer chefe" },
  2: { label: "Completar quests", icon: "scroll", target: "ID da quest", anyLabel: "qualquer quest" },
  3: { label: "Completar TMQ", icon: "hourglass", target: "TBLIDX da TMQ", anyLabel: "qualquer TMQ" },
  4: { label: "Completar dungeon (UD)", icon: "castle", target: "Mundo da dungeon", anyLabel: "" },
  5: { label: "Dias de login", icon: "calendar", target: null, anyLabel: "" },
};

export const TRANSFORMATIONS = [
  { value: 0, label: "Sem exigência", name: "" },
  { value: 1, label: "Kaioken (todas as raças)", name: "Kaioken" },
  { value: 2, label: "Forma racial (cada raça a sua)", name: "forma racial" },
  { value: 3, label: "Super Saiyajin (só humanos)", name: "Super Saiyajin" },
  { value: 4, label: "Pure Majin (só Majins)", name: "Pure Majin" },
  { value: 5, label: "Namek Gigante (só Nameks)", name: "Namek Gigante" },
];

export const REWARD_TYPES: Record<BattlePassRewardType, { label: string; icon: IconName }> = {
  0: { label: "Item", icon: "items" },
  1: { label: "Título", icon: "award" },
  2: { label: "Zeni", icon: "coins" },
  3: { label: "Cash da conta", icon: "ticket" },
};

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
export const formatDateTime = (unix: number) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(unix * 1000));
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
const stripAccents = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
/** datetime-local trabalha no fuso do navegador; o banco guarda Unix em segundos. */
const toInputDateTime = (unix: number) => {
  const date = new Date(unix * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fromInputDateTime = (value: string) => Math.floor(new Date(value).getTime() / 1000);

/** Como o nome aparece no jogo: {count} vira a quantidade e {transformation} o nome da forma. */
export function resolveMissionName(mission: Pick<BattlePassMissionValues, "name" | "requiredAmount" | "transformation">) {
  const forma = mission.transformation === 2 ? "Super Saiyajin / Pure Majin / Namek Gigante" : TRANSFORMATIONS.find((entry) => entry.value === mission.transformation)?.name || "transformação";
  return mission.name.replaceAll("{count}", formatNumber(mission.requiredAmount)).replaceAll("{transformation}", forma);
}

export function describeReward(reward: Pick<BattlePassReward, "rewardType" | "rewardId" | "quantity" | "titleDurationDays" | "itemName">) {
  if (reward.rewardType === 0) return `${reward.itemName ?? `Item #${reward.rewardId}`}${reward.quantity > 1 ? ` ×${formatNumber(reward.quantity)}` : ""}`;
  if (reward.rewardType === 1) return `Título #${reward.rewardId}${reward.titleDurationDays ? ` · ${reward.titleDurationDays} dias` : " · permanente"}`;
  if (reward.rewardType === 2) return `${formatNumber(reward.quantity)} zeni`;
  return `${formatNumber(reward.quantity)} cash`;
}

// ---------------------------------------------------------------- peças comuns

export function ItemIcon({ iconName, size = 32 }: { iconName: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!iconName || failed) return <span className="bpItemIcon" style={{ width: size, height: size }}>—</span>;
  return <span className="bpItemIcon" style={{ width: size, height: size }}><Image src={`/api/items/icons/${encodeURIComponent(iconName)}`} alt="" width={size} height={size} unoptimized onError={() => setFailed(true)} /></span>;
}

type PickerOption = { id: number; name: string; detail: string; iconName: string | null };

/** Busca no catálogo de itens ou de mobs; quem já sabe o TBLIDX pode digitá-lo na busca. */
function CatalogPicker({ kind, value, valueName, valueIcon = null, onPick, allowAny, disabled }: {
  kind: "item" | "mob"; value: number; valueName: string | null; valueIcon?: string | null;
  onPick: (id: number, name: string | null, iconName: string | null) => void; allowAny?: string; disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setOptions([]); setOpen(false); return; }
      try {
        const response = await fetch(`/api/${kind === "item" ? "items" : "mobs"}?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        if (kind === "item") {
          const body = (await response.json()) as ItemCatalogResponse;
          setOptions(body.items.slice(0, 20).map((item) => ({ id: item.tblidx, name: item.name, detail: `#${item.tblidx}`, iconName: item.iconName || null })));
        } else {
          const body = (await response.json()) as MobCatalogResponse;
          setOptions(body.mobs.slice(0, 20).map((mob) => ({ id: mob.tblidx, name: mob.name, detail: `#${mob.tblidx} · nível ${mob.level}`, iconName: null })));
        }
        setOpen(true);
      } catch { /* busca abortada */ }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [kind, search]);

  return <div className="bpPicker">
    <div className="bpPickerCurrent">
      {kind === "item" && <ItemIcon key={valueIcon ?? "vazio"} iconName={value ? valueIcon : null} size={28} />}
      <div><strong>{value ? valueName ?? `#${value}` : allowAny ?? "Nenhum"}</strong><small>{value ? `TBLIDX ${value}` : allowAny ? "sem filtro" : "escolha abaixo"}</small></div>
      {value !== 0 && allowAny && !disabled && <button type="button" className="skillRefClear" onClick={() => onPick(0, null, null)}>{allowAny}</button>}
    </div>
    {!disabled && <div className="dropSlotSearch">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${kind === "item" ? "item" : "mob"} por nome ou TBLIDX`} maxLength={80} />
      {open && options.length > 0 && <ul className="dropSlotOptions">
        {options.map((option) => <li key={option.id}><button type="button" onClick={() => { onPick(option.id, option.name, option.iconName); setOpen(false); setSearch(""); }}>
          {kind === "item" && <ItemIcon iconName={option.iconName} size={22} />}
          <span>{option.name}</span><code>{option.detail}</code>
        </button></li>)}
      </ul>}
    </div>}
  </div>;
}

function Modal({ title, eyebrow, onClose, children, wide }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`editorModal bpModal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modalHeader"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        <button className="closeButton" type="button" onClick={onClose} aria-label="Fechar">×</button></div>
      {children}
    </section>
  </div>;
}

function useSubmit(onSubmit: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await onSubmit(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return { busy, error, submit };
}

function NameField({ label, value, limit, onChange, disabled, hint }: { label: string; value: string; limit: number; onChange: (value: string) => void; disabled?: boolean; hint?: ReactNode }) {
  const bytes = utf8Bytes(value);
  const accented = /[^\x20-\x7e]/.test(value);
  return <label className="bpField wide"><span className="bpFieldLabel">{label}<em className={bytes > limit ? "over" : ""}>{bytes}/{limit} bytes</em></span>
    <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} maxLength={limit * 2} required />
    {accented && <small className="bpAccentHint">Tem acento ou símbolo: o servidor não define o charset da conexão com o banco, então pode aparecer quebrado no jogo.
      {!disabled && <button type="button" onClick={() => onChange(stripAccents(value))}>Tirar acentos</button>}</small>}
    {hint}
  </label>;
}

// ---------------------------------------------------------------- temporada

export function SeasonFormModal({ season, suggestedId, onClose, onSubmit }: {
  season: BattlePassSeasonSummary | null; suggestedId: number; onClose: () => void; onSubmit: (values: BattlePassSeasonValues) => Promise<void>;
}) {
  const [values, setValues] = useState<BattlePassSeasonValues>(() => {
    if (season) return season;
    const now = Math.floor(Date.now() / 1000);
    return { seasonId: suggestedId, name: "", startTime: now, endTime: now + 30 * 86400, maxLevel: 30, xpPerLevel: 1000, premiumPrice: 0, dayOffsetMinutes: -180 };
  });
  const locked = Boolean(season?.locked);
  const { busy, error, submit } = useSubmit(() => onSubmit(values));
  const set = <K extends keyof BattlePassSeasonValues>(key: K, value: BattlePassSeasonValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const days = Math.round((values.endTime - values.startTime) / 86400);

  return <Modal title={season ? `Editar ${season.name}` : "Nova temporada"} eyebrow={season ? `TEMPORADA #${season.seasonId}` : "BATTLE PASS"} onClose={onClose}>
    <form onSubmit={submit} className="bpForm">
      {locked && <div className="readonlyNotice"><strong>Temporada com jogadores</strong><span>Início, nível máximo, XP por nível e fuso ficam travados para não mudar o progresso de quem já joga. O fim só pode ser prorrogado.</span></div>}
      <div className="bpFormGrid">
        <label className="bpField"><span className="bpFieldLabel">ID da temporada</span>
          <input type="number" min={1} value={values.seasonId} disabled={Boolean(season)} onChange={(event) => set("seasonId", Number(event.target.value))} required /></label>
        <NameField label="Nome" value={values.name} limit={63} onChange={(value) => set("name", value)} />
        <label className="bpField"><span className="bpFieldLabel">Início</span>
          <input type="datetime-local" value={toInputDateTime(values.startTime)} disabled={locked} onChange={(event) => set("startTime", fromInputDateTime(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">Fim<em>{days > 0 ? `${days} dias` : "antes do início"}</em></span>
          <input type="datetime-local" value={toInputDateTime(values.endTime)} onChange={(event) => set("endTime", fromInputDateTime(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">Nível máximo<em>1 a 128</em></span>
          <input type="number" min={1} max={128} value={values.maxLevel} disabled={locked} onChange={(event) => set("maxLevel", Number(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">XP por nível</span>
          <input type="number" min={1} max={10000000} value={values.xpPerLevel} disabled={locked} onChange={(event) => set("xpPerLevel", Number(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">Preço do Premium (cash)<em>0 desliga a compra</em></span>
          <input type="number" min={0} value={values.premiumPrice} onChange={(event) => set("premiumPrice", Number(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">Virada do dia de login</span>
          <select value={values.dayOffsetMinutes} disabled={locked} onChange={(event) => set("dayOffsetMinutes", Number(event.target.value))}>
            {[[-180, "Brasília (UTC-3)"], [-240, "Manaus (UTC-4)"], [-300, "Acre (UTC-5)"], [0, "UTC"]].map(([minutes, label]) =>
              <option key={minutes} value={minutes}>{label}</option>)}
            {![-180, -240, -300, 0].includes(values.dayOffsetMinutes) && <option value={values.dayOffsetMinutes}>{values.dayOffsetMinutes} min</option>}
          </select></label>
      </div>
      <p className="bpFormNote">Chegar ao nível {values.maxLevel} exige {formatNumber(Math.max(0, values.maxLevel - 1) * values.xpPerLevel)} XP somando todas as missões.{!season && " A temporada nasce desligada: ative depois de cadastrar missões e recompensas."}</p>
      {error && <div className="formError">{error}</div>}
      <div className="modalActions"><button type="button" className="catalogClearButton" onClick={onClose}>Cancelar</button>
        <button className="primaryButton compact" disabled={busy}>{busy ? "Salvando..." : season ? "Salvar temporada" : "Criar temporada"}</button></div>
    </form>
  </Modal>;
}

export function CloneSeasonModal({ source, suggestedId, onClose, onSubmit }: {
  source: BattlePassSeasonSummary; suggestedId: number; onClose: () => void; onSubmit: (values: { seasonId: number; name: string; startTime: number }) => Promise<void>;
}) {
  const [seasonId, setSeasonId] = useState(suggestedId);
  const [name, setName] = useState(`${source.name} (cópia)`.slice(0, 63));
  const [startTime, setStartTime] = useState(() => Math.max(source.endTime, Math.floor(Date.now() / 1000)));
  const { busy, error, submit } = useSubmit(() => onSubmit({ seasonId, name, startTime }));
  const duration = source.endTime - source.startTime;
  return <Modal title={`Clonar ${source.name}`} eyebrow="NOVA TEMPORADA A PARTIR DE OUTRA" onClose={onClose}>
    <form onSubmit={submit} className="bpForm">
      <p className="bpFormNote">Copia curva de XP, preço, {source.missionCount} missões (com IDs novos) e {source.rewardCount} recompensas. Progresso e resgates não são copiados, e a nova temporada nasce desligada.</p>
      <div className="bpFormGrid">
        <label className="bpField"><span className="bpFieldLabel">ID da nova temporada</span><input type="number" min={1} value={seasonId} onChange={(event) => setSeasonId(Number(event.target.value))} required /></label>
        <NameField label="Nome" value={name} limit={63} onChange={setName} />
        <label className="bpField"><span className="bpFieldLabel">Início<em>termina {formatDateTime(startTime + duration)}</em></span>
          <input type="datetime-local" value={toInputDateTime(startTime)} onChange={(event) => setStartTime(fromInputDateTime(event.target.value))} required /></label>
      </div>
      {error && <div className="formError">{error}</div>}
      <div className="modalActions"><button type="button" className="catalogClearButton" onClick={onClose}>Cancelar</button>
        <button className="primaryButton compact" disabled={busy}>{busy ? "Clonando..." : "Criar cópia"}</button></div>
    </form>
  </Modal>;
}

// ---------------------------------------------------------------- missão

export function MissionFormModal({ mission, suggestedId, season, conditionsAvailable, onClose, onSubmit }: {
  mission: BattlePassMission | null; suggestedId: number; season: BattlePassSeasonSummary; conditionsAvailable: boolean;
  onClose: () => void; onSubmit: (values: BattlePassMissionValues, mode: "create" | "update") => Promise<void>;
}) {
  const [values, setValues] = useState<BattlePassMissionValues>(() => mission ?? {
    missionId: suggestedId, name: "Derrote {count} mobs", releaseDay: 0, objective: 0, targetId: 0, requiredAmount: 10, experience: 100,
    completionMobId: 0, transformation: 0, worldId: 0, areaX: 0, areaZ: 0, areaRadius: 0,
  });
  const [names, setNames] = useState({ target: mission?.targetName ?? null, completion: mission?.completionMobName ?? null });
  const locked = Boolean(mission?.locked);
  const { busy, error, submit } = useSubmit(() => onSubmit(values, mission ? "update" : "create"));
  const set = <K extends keyof BattlePassMissionValues>(key: K, value: BattlePassMissionValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const objective = OBJECTIVES[values.objective];
  const kill = values.objective === 0 || values.objective === 1;
  const releaseAt = season.startTime + values.releaseDay * 86400;

  function changeObjective(next: BattlePassObjective) {
    // Campos que só valem para outro objetivo voltam a zero, senão o servidor recusa.
    setValues((current) => ({
      ...current, objective: next, targetId: 0, completionMobId: 0,
      ...(next === 0 || next === 1 ? {} : { transformation: 0, worldId: 0, areaX: 0, areaZ: 0, areaRadius: 0 }),
    }));
    setNames({ target: null, completion: null });
  }

  return <Modal title={mission ? `Missão #${mission.missionId}` : "Nova missão"} eyebrow={season.name.toUpperCase()} onClose={onClose} wide>
    <form onSubmit={submit} className="bpForm">
      {locked && <div className="readonlyNotice"><strong>Missão já liberada para jogadores</strong><span>Só o nome pode mudar. Para outro objetivo, crie uma missão nova com liberação futura.</span></div>}
      {season.locked && !mission && <div className="readonlyNotice"><strong>Temporada em andamento</strong><span>Missões novas precisam liberar no futuro (dia de liberação depois de hoje).</span></div>}

      <div className="bpObjectivePicker" role="radiogroup" aria-label="Objetivo">
        {(Object.keys(OBJECTIVES).map(Number) as BattlePassObjective[]).map((key) => <button key={key} type="button" role="radio" aria-checked={values.objective === key}
          className={values.objective === key ? "active" : ""} disabled={locked} onClick={() => changeObjective(key)}>
          <Icon name={OBJECTIVES[key].icon} size={18} /><span>{OBJECTIVES[key].label}</span></button>)}
      </div>

      <div className="bpFormGrid">
        <label className="bpField"><span className="bpFieldLabel">ID da missão<em>único no banco</em></span>
          <input type="number" min={1} value={values.missionId} disabled={Boolean(mission)} onChange={(event) => set("missionId", Number(event.target.value))} required /></label>
        <NameField label="Nome" value={values.name} limit={95} onChange={(value) => set("name", value)} hint={<small className="bpTokens">
          <button type="button" onClick={() => set("name", `${values.name}{count}`)}>+ {"{count}"}</button>
          {kill && <button type="button" onClick={() => set("name", `${values.name}{transformation}`)}>+ {"{transformation}"}</button>}
          <span>No jogo: <b>{resolveMissionName(values)}</b></span></small>} />

        {objective.target && values.objective !== 4 && <div className="bpField wide"><span className="bpFieldLabel">{objective.target}</span>
          {kill
            ? <CatalogPicker kind="mob" value={values.targetId} valueName={names.target} allowAny={objective.anyLabel} disabled={locked} onPick={(id, name) => { set("targetId", id); setNames((current) => ({ ...current, target: name })); }} />
            : <><input type="number" min={0} value={values.targetId} disabled={locked} onChange={(event) => set("targetId", Number(event.target.value))} />
              <small className="bpFieldHint">0 = {objective.anyLabel}.</small></>}
        </div>}
        {values.objective === 4 && <>
          <label className="bpField"><span className="bpFieldLabel">Mundo da dungeon<em>TBLIDX da WorldTable</em></span>
            <input type="number" min={1} value={values.targetId || ""} disabled={locked} onChange={(event) => set("targetId", Number(event.target.value))} required /></label>
          <div className="bpField wide"><span className="bpFieldLabel">Chefe final</span>
            <CatalogPicker kind="mob" value={values.completionMobId} valueName={names.completion} disabled={locked} onPick={(id, name) => { set("completionMobId", id); setNames((current) => ({ ...current, completion: name })); }} /></div>
        </>}

        <label className="bpField"><span className="bpFieldLabel">{values.objective === 5 ? "Dias de login" : "Quantidade"}</span>
          <input type="number" min={1} value={values.requiredAmount} disabled={locked} onChange={(event) => set("requiredAmount", Number(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">XP da missão</span>
          <input type="number" min={1} value={values.experience} disabled={locked} onChange={(event) => set("experience", Number(event.target.value))} required /></label>
        <label className="bpField"><span className="bpFieldLabel">Libera no dia<em>{formatDateTime(releaseAt)}</em></span>
          <input type="number" min={0} max={65535} value={values.releaseDay} disabled={locked} onChange={(event) => set("releaseDay", Number(event.target.value))} required /></label>
      </div>

      {kill && <fieldset className="bpConditions" disabled={locked || !conditionsAvailable}>
        <legend>Condições do abate {!conditionsAvailable && <em>(exige a migração 20261014_battle_pass_mission_conditions.sql)</em>}</legend>
        <div className="bpFormGrid">
          <label className="bpField"><span className="bpFieldLabel">Transformação</span>
            <select value={values.transformation} onChange={(event) => set("transformation", Number(event.target.value))}>
              {TRANSFORMATIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
          <label className="bpField"><span className="bpFieldLabel">Mapa<em>TBLIDX do mundo · 0 = qualquer</em></span>
            <input type="number" min={0} value={values.worldId} onChange={(event) => set("worldId", Number(event.target.value))} /></label>
          <label className="bpField"><span className="bpFieldLabel">Centro X</span><input type="number" step="any" value={values.areaX} onChange={(event) => set("areaX", Number(event.target.value))} /></label>
          <label className="bpField"><span className="bpFieldLabel">Centro Z</span><input type="number" step="any" value={values.areaZ} onChange={(event) => set("areaZ", Number(event.target.value))} /></label>
          <label className="bpField"><span className="bpFieldLabel">Raio<em>0 = mapa inteiro</em></span><input type="number" step="any" min={0} value={values.areaRadius} onChange={(event) => set("areaRadius", Number(event.target.value))} /></label>
        </div>
        <small className="bpFieldHint">Tudo combina por E: transformação ativa no momento do abate, no mapa indicado e com o mob dentro do círculo. A área usa a posição do mob, em coordenadas do mundo.</small>
      </fieldset>}

      {error && <div className="formError">{error}</div>}
      <div className="modalActions"><button type="button" className="catalogClearButton" onClick={onClose}>Cancelar</button>
        <button className="primaryButton compact" disabled={busy}>{busy ? "Salvando..." : mission ? "Salvar missão" : "Criar missão"}</button></div>
    </form>
  </Modal>;
}

// ---------------------------------------------------------------- recompensa

export function RewardFormModal({ reward, slot, season, featuredAvailable, onClose, onSubmit }: {
  reward: BattlePassReward | null; slot: { level: number; track: 0 | 1 }; season: BattlePassSeasonSummary; featuredAvailable: boolean;
  onClose: () => void; onSubmit: (values: BattlePassRewardValues, original: { level: number; track: 0 | 1 } | null) => Promise<void>;
}) {
  const [values, setValues] = useState<BattlePassRewardValues>(() => reward ?? {
    level: slot.level, track: slot.track, rewardType: 2, rewardId: 0, quantity: 1000, titleDurationDays: 0, featured: false,
  });
  const [itemName, setItemName] = useState(reward?.itemName ?? null);
  const [itemIcon, setItemIcon] = useState(reward?.iconName ?? null);
  const locked = Boolean(reward?.locked);
  const { busy, error, submit } = useSubmit(() => onSubmit(values, reward ? { level: reward.level, track: reward.track } : null));
  const set = <K extends keyof BattlePassRewardValues>(key: K, value: BattlePassRewardValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  function changeType(type: BattlePassRewardType) {
    setValues((current) => ({ ...current, rewardType: type, rewardId: 0, titleDurationDays: 0, quantity: type === 1 ? 1 : type === 2 ? 1000 : type === 3 ? 10 : 1 }));
    setItemName(null);
    setItemIcon(null);
  }

  return <Modal title={reward ? `Recompensa do nível ${reward.level}` : `Nova recompensa · nível ${slot.level}`} eyebrow={values.track ? "TRILHA PREMIUM" : "TRILHA GRÁTIS"} onClose={onClose}>
    <form onSubmit={submit} className="bpForm">
      {locked && <div className="readonlyNotice"><strong>Já resgatada {reward?.claims} vez(es)</strong><span>O valor não pode mudar para não entregar coisas diferentes a jogadores diferentes. Só o destaque visual pode ser ligado ou desligado.</span></div>}
      <div className="bpFormGrid">
        <label className="bpField"><span className="bpFieldLabel">Nível<em>1 a {season.maxLevel}</em></span>
          <input type="number" min={1} max={season.maxLevel} value={values.level} disabled={locked} onChange={(event) => set("level", Number(event.target.value))} required /></label>
        <div className="bpField"><span className="bpFieldLabel">Trilha</span>
          <div className="bpSegmented">{([0, 1] as const).map((track) => <button key={track} type="button" disabled={locked} className={values.track === track ? `active${track ? " premium" : ""}` : ""} onClick={() => set("track", track)}>{track ? "Premium" : "Grátis"}</button>)}</div></div>
      </div>
      <div className="bpRewardTypes">
        {(Object.keys(REWARD_TYPES).map(Number) as BattlePassRewardType[]).map((type) => <button key={type} type="button" disabled={locked}
          className={values.rewardType === type ? "active" : ""} onClick={() => changeType(type)}><Icon name={REWARD_TYPES[type].icon} size={18} /><span>{REWARD_TYPES[type].label}</span></button>)}
      </div>
      <div className="bpFormGrid">
        {values.rewardType === 0 && <div className="bpField wide"><span className="bpFieldLabel">Item</span>
          <CatalogPicker kind="item" value={values.rewardId} valueName={itemName} valueIcon={itemIcon} disabled={locked} onPick={(id, name, icon) => { set("rewardId", id); setItemName(name); setItemIcon(icon); }} /></div>}
        {values.rewardType === 1 && <>
          <label className="bpField"><span className="bpFieldLabel">ID do título<em>1 a 512</em></span>
            <input type="number" min={1} max={512} value={values.rewardId || ""} disabled={locked} onChange={(event) => set("rewardId", Number(event.target.value))} required /></label>
          <label className="bpField"><span className="bpFieldLabel">Duração<em>0 = permanente</em></span>
            <input type="number" min={0} max={36500} value={values.titleDurationDays} disabled={locked} onChange={(event) => set("titleDurationDays", Number(event.target.value))} /></label>
        </>}
        {values.rewardType !== 1 && <label className="bpField"><span className="bpFieldLabel">{values.rewardType === 0 ? "Quantidade" : values.rewardType === 2 ? "Zeni" : "Cash"}</span>
          <input type="number" min={1} value={values.quantity} disabled={locked} onChange={(event) => set("quantity", Number(event.target.value))} required /></label>}
      </div>
      <label className={`bpFeatured${values.featured ? " on" : ""}`}>
        <input type="checkbox" checked={values.featured} disabled={!featuredAvailable} onChange={(event) => set("featured", event.target.checked)} />
        <Icon name="star" size={16} /><span><strong>Recompensa em destaque</strong><small>{featuredAvailable ? "Card maior, com moldura dourada e brilho no jogo. Só muda a aparência." : "Exige a migração 20261014_battle_pass_featured.sql."}</small></span>
      </label>
      {error && <div className="formError">{error}</div>}
      <div className="modalActions"><button type="button" className="catalogClearButton" onClick={onClose}>Cancelar</button>
        <button className="primaryButton compact" disabled={busy}>{busy ? "Salvando..." : reward ? "Salvar recompensa" : "Adicionar recompensa"}</button></div>
    </form>
  </Modal>;
}
