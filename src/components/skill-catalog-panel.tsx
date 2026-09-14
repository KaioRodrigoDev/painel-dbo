"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { SkillDraftCreator } from "@/components/skill-draft-creator";
import type { SkillCatalogEntry, SkillCatalogResponse } from "@/lib/types";

const SKILL_CLASS_NAMES: Record<number, string> = { 0: "Passiva", 1: "Ativa", 2: "HTB", 255: "Desconhecida" };
const SKILL_TYPE_NAMES: Record<number, string> = { 0: "Sem tipo", 1: "Física", 2: "Energia", 3: "Estado", 255: "Desconhecido" };
const ACTIVE_TYPE_NAMES: Record<number, string> = { 0: "Dano direto", 1: "Dano periódico", 2: "Cura direta", 3: "Cura periódica", 4: "Bênção direta", 5: "Buff", 6: "Maldição direta", 7: "Debuff", 255: "Desconhecido" };
const TARGET_NAMES: Record<number, string> = { 0: "Próprio", 1: "Inimigo", 2: "Aliança", 3: "Grupo", 4: "Grupo de mobs", 5: "Qualquer", 6: "Invocação", 7: "Qualquer NPC", 8: "Qualquer mob", 9: "Qualquer aliança", 255: "Desconhecido" };
const CLASS_NAMES = ["Lutador humano", "Místico humano", "Engenheiro humano", "Guerreiro Namek", "Místico Namek", "Mighty Majin", "Wonder Majin", "Street Fighter", "Sword Master", "Crane Roshi", "Turtle Roshi", "Gun Mania", "Mech Mania", "Dark Warrior", "Shadow Knight", "Dende Priest", "Poko Priest", "Ultimate Majin", "Grand Chef Majin", "Plasma Majin", "Karma Majin"];

function label(map: Record<number, string>, value: number, prefix: string) { return map[value] ?? `${prefix} ${value}`; }
function formatNumber(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value); }
function formatDuration(value: number) { return value ? `${formatNumber(value / 1000)} s` : "Instantâneo"; }
function validIds(values: number[]) { return values.filter((value) => value !== 0 && value !== 0xffffffff).join(", ") || "—"; }
function classesForFlag(flag: number) { const names = CLASS_NAMES.filter((_, index) => (flag & (1 << index)) !== 0); return names.length ? names.join(", ") : "Sistema/sem classe"; }
function usable(value: number | undefined) { return value !== undefined && value !== 0 && value !== 0xffffffff; }

/** Efeitos da skill, um por slot preenchido: "1201 · tipo 3 · 120". */
function describeEffects(skill: SkillCatalogEntry) {
  return skill.effectIds
    .map((id, slot) => ({ id, tipo: skill.effectTypes[slot], valor: skill.effectValues[slot] }))
    .filter((efeito) => usable(efeito.id))
    .map((efeito) => `${efeito.id} · tipo ${efeito.tipo ?? 0} · ${formatNumber(efeito.valor ?? 0)}`)
    .join("   |   ") || "—";
}

/** Bonus que a skill ganha por bola de RP gasta, no mesmo formato dos efeitos. */
function describeRpBonuses(skill: SkillCatalogEntry) {
  return skill.rpEffects
    .map((id, slot) => ({ id, valor: skill.rpEffectValues[slot] }))
    .filter((bonus) => usable(bonus.id))
    .map((bonus) => `${bonus.id} · ${formatNumber(bonus.valor ?? 0)}`)
    .join("   |   ") || "—";
}

function SkillIcon({ skill, size = 38 }: { skill: SkillCatalogEntry; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!skill.iconName || failed) return <span className="itemIconPlaceholder">—</span>;
  return <span className="itemIconPlaceholder itemIconLoaded"><Image src={`/api/skills/icons/${encodeURIComponent(skill.iconName)}`} alt="" width={size} height={size} unoptimized onError={() => setFailed(true)} /></span>;
}

export function SkillCatalogPanel() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [skillClass, setSkillClass] = useState("");
  const [skillType, setSkillType] = useState("");
  const [characterClass, setCharacterClass] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SkillCatalogResponse | null>(null);
  const [selected, setSelected] = useState<SkillCatalogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SkillCatalogEntry | null>(null);

  const loadSkills = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (skillClass) params.set("skillClass", skillClass);
    if (skillType) params.set("skillType", skillType);
    if (characterClass) params.set("characterClass", characterClass);
    try {
      const response = await fetch(`/api/skills?${params}`, { signal, cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as SkillCatalogResponse | { error?: string };
      if (!response.ok) { if (response.status === 401) { router.push("/login"); return; } throw new Error("error" in body ? body.error : "Falha ao carregar skills."); }
      setData(body as SkillCatalogResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar skills.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [characterClass, page, router, search, skillClass, skillType]);

  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void loadSkills(controller.signal), 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [loadSkills]);
  function submitSearch(event: FormEvent) { event.preventDefault(); setPage(1); setSearch(draftSearch.trim()); }
  function clearFilters() { setDraftSearch(""); setSearch(""); setSkillClass(""); setSkillType(""); setCharacterClass(""); setPage(1); }

  if (creating) return <SkillDraftCreator onBack={() => setCreating(false)} />;
  if (editing) return <SkillDraftCreator initialSkill={editing} onBack={() => setEditing(null)} />;

  return <div className="itemCatalogPanel">
    <form className="itemFilters skillFilters" onSubmit={submitSearch}>
      <div className="searchInputWrap"><span aria-hidden="true">⌕</span><input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Buscar por nome, TBLIDX ou ícone" maxLength={80} /></div>
      <select value={skillClass} onChange={(event) => { setSkillClass(event.target.value); setPage(1); }} aria-label="Filtrar classe da skill"><option value="">Ativas e passivas</option>{data?.availableSkillClasses.map((value) => <option key={value} value={value}>{label(SKILL_CLASS_NAMES, value, "Classe")}</option>)}</select>
      <select value={skillType} onChange={(event) => { setSkillType(event.target.value); setPage(1); }} aria-label="Filtrar tipo da skill"><option value="">Todos os tipos</option>{data?.availableSkillTypes.map((value) => <option key={value} value={value}>{label(SKILL_TYPE_NAMES, value, "Tipo")}</option>)}</select>
      <select value={characterClass} onChange={(event) => { setCharacterClass(event.target.value); setPage(1); }} aria-label="Filtrar classe de personagem"><option value="">Todas as classes</option>{CLASS_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
      <button className="primaryButton compact" type="submit">Buscar</button>
      {(search || skillClass || skillType || characterClass) && <button className="catalogClearButton" type="button" onClick={clearFilters}>Limpar</button>}
    </form>

    <div className="listHeader"><div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> skills encontradas</span></div><div className="catalogSource">{data && <span>{data.sourceFile} + {data.textSourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}<button className="refreshButton" onClick={() => void loadSkills()} disabled={loading}>↻ Atualizar</button><button className="primaryButton compact" onClick={() => setCreating(true)}>+ Criar habilidade</button></div></div>
    {error && <div className="errorBanner"><strong>Falha no catálogo</strong><span>{error}</span></div>}
    {loading && <div className="loadingState"><span className="spinner" /> Lendo o catálogo de skills...</div>}
    {!loading && data?.skills.length === 0 && <div className="emptyState">Nenhuma skill corresponde aos filtros.</div>}
    {!loading && data && data.skills.length > 0 && <div className="itemTableWrap"><table className="itemTable"><thead><tr><th>TBLIDX</th><th>Skill</th><th>Classe</th><th>Tipo</th><th>Grade</th><th>Requisitos</th><th /></tr></thead><tbody>{data.skills.map((skill) => <tr key={skill.tblidx}>
      <td><code>{skill.tblidx}</code></td><td><div className="itemIdentity"><SkillIcon skill={skill} /><div><strong>{skill.name}</strong><small>{skill.iconName || "Sem ícone informado"}</small></div></div></td>
      <td><span className="catalogBadge">{label(SKILL_CLASS_NAMES, skill.skillClass, "Classe")}</span></td><td>{label(SKILL_TYPE_NAMES, skill.skillType, "Tipo")}<br /><small>{label(ACTIVE_TYPE_NAMES, skill.activeType, "Efeito")}</small></td><td>{skill.grade}</td><td><small>Nível {skill.requiredLevel} · SP {skill.requiredSp}<br />EP {skill.requiredEp} · CD {formatDuration(skill.cooldownMs)}</small></td><td><div className="catalogRowActions"><button className="catalogDetailsButton" onClick={() => setSelected(skill)}>Detalhes</button><button className="primaryButton compact" onClick={() => setEditing(skill)}>Editar</button></div></td>
    </tr>)}</tbody></table></div>}
    {data && data.totalPages > 1 && <nav className="pagination" aria-label="Paginação do catálogo de skills"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Anterior</button><span>Página <strong>{data.page}</strong> de {data.totalPages}</span><button disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Próxima →</button></nav>}
    {selected && <SkillDetails skill={selected} onClose={() => setSelected(null)} onEdit={() => { setSelected(null); setEditing(selected); }} />}
  </div>;
}

function SkillDetails({ skill, onClose, onEdit }: { skill: SkillCatalogEntry; onClose: () => void; onEdit: () => void }) {
  const details: Array<[string, string | number]> = [
    ["TBLIDX", skill.tblidx], ["Text ID", skill.nameTextId], ["Note ID", skill.noteTextId], ["Nome interno", skill.internalName || "—"], ["Válida", skill.valid ? "Sim" : "Não"],
    ["Classe da skill", `${label(SKILL_CLASS_NAMES, skill.skillClass, "Classe")} (${skill.skillClass})`], ["Tipo", `${label(SKILL_TYPE_NAMES, skill.skillType, "Tipo")} (${skill.skillType})`], ["Ativação", `${label(ACTIVE_TYPE_NAMES, skill.activeType, "Efeito")} (${skill.activeType})`],
    ["Classes permitidas", classesForFlag(skill.classFlag)], ["Class flag", `0x${skill.classFlag.toString(16).toUpperCase()}`], ["Grade", skill.grade], ["Slot da árvore", skill.slotIndex], ["Grupo", skill.skillGroup], ["Buff group", skill.buffGroup],
    ["Nível necessário", skill.requiredLevel], ["SP necessário", skill.requiredSp], ["Zeni necessário", formatNumber(skill.requiredZenny)], ["Autotreino", skill.selfTrain ? "Sim" : "Não"], ["Pré-requisitos", validIds(skill.prerequisiteSkillIds)], ["Skill raiz", skill.rootSkillId], ["Próxima skill", skill.nextSkillId],
    ["LP consumido", formatNumber(skill.requiredLp)], ["EP consumido", skill.requiredEp], ["Bolas de RP", skill.requiredRpBalls], ["Casting", formatDuration(skill.castingTimeMs)], ["Cooldown", formatDuration(skill.cooldownMs)], ["Duração", formatDuration(skill.keepTimeMs)], ["Mantém efeito", skill.keepEffect ? "Sim" : "Não"],
    ["Alcance", `${formatNumber(skill.useRangeMin)}–${formatNumber(skill.useRangeMax)}`], ["Alvo indicado", skill.appointTarget], ["Alvo aplicado", `${label(TARGET_NAMES, skill.applyTarget, "Alvo")} (${skill.applyTarget})`], ["Máximo de alvos", skill.applyTargetMax], ["Área", `${skill.applyRange} · ${skill.applyAreaSize1} × ${skill.applyAreaSize2}`],
    ["Efeitos", describeEffects(skill)], ["Bônus de RP", describeRpBonuses(skill)], ["Aggro adicional", formatNumber(skill.additionalAggro)], ["Taxa de sucesso", formatNumber(skill.successRate)],
    ["Animação", skill.actionAnimation], ["Tempo da animação", formatDuration(skill.animationTimeMs)], ["Dash", skill.dashAble ? "Sim" : "Não"], ["Function flag", `0x${skill.functionFlag.toString(16).toUpperCase()}`], ["Restriction flag", `0x${skill.restrictionRuleFlag.toString(16).toUpperCase()}`],
  ];
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="editorModal itemDetailsModal" role="dialog" aria-modal="true" aria-labelledby="skill-details-title"><div className="modalHeader"><div><div className="eyebrow">SKILL DO CATÁLOGO</div><h2 id="skill-details-title">{skill.name}</h2><p>#{skill.tblidx} · {skill.iconName || "sem ícone"}</p></div><button className="closeButton" onClick={onClose} aria-label="Fechar">×</button></div>{skill.description && <div className="modelNames"><span>Descrição <strong>{skill.description}</strong></span></div>}<div className="itemDetailGrid">{details.map(([name, value]) => <div key={name}><small>{name}</small><strong>{value}</strong></div>)}</div><div className="readonlyNotice"><strong>Edição protegida por rascunho</strong><span>O formulário registra somente as diferenças; RDF, banco, cliente e GameServer não são alterados automaticamente.</span></div><div className="modalActions"><button className="catalogClearButton" type="button" onClick={onClose}>Fechar</button><button className="primaryButton" type="button" onClick={onEdit}>Editar esta skill</button></div></section></div>;
}
