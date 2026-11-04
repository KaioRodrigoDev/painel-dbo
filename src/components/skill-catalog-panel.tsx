"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { SkillBatchPanel } from "@/components/skill-batch-panel";
import { SkillDraftCreator } from "@/components/skill-draft-creator";
import type { SkillBatchPreview, SkillCatalogEntry, SkillCatalogResponse, SkillDraft, SkillDraftsResponse } from "@/lib/types";
import { Pagination } from "@/components/pagination";

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

const AREA_NAMES: Record<number, string> = { 1: "Área circular", 2: "Área retangular", 3: "Linha frontal", 4: "Frontal flexível", 5: "Área em anel", 6: "Área em cone" };
const ALL_CLASSES_FLAG = (1 << CLASS_NAMES.length) - 1;

/**
 * Família de cor do comportamento principal: dá para bater o olho e separar dano de cura.
 * Passiva não tem comportamento ativo -- o campo fica no valor padrão 0, que leria "Dano
 * direto" e enganaria quem olha.
 */
function behaviorKind(skill: SkillCatalogEntry) {
  if (skill.skillClass === 0) return "passive";
  const activeType = skill.activeType;
  if (activeType === 0 || activeType === 1) return "damage";
  if (activeType === 2 || activeType === 3) return "heal";
  if (activeType === 4 || activeType === 5) return "buff";
  if (activeType === 6 || activeType === 7) return "debuff";
  return "other";
}

/** "Área circular 5m · Inimigo" ou "Alvo único · Aliança". Passiva não escolhe alvo. */
function targetSummary(skill: SkillCatalogEntry) {
  if (skill.skillClass === 0) return { area: false, text: "Efeito permanente" };
  const quem = label(TARGET_NAMES, skill.applyTarget, "Alvo");
  if (skill.applyRange === 0) return { area: false, text: `Alvo único · ${quem}` };
  const forma = AREA_NAMES[skill.applyRange] ?? `Área ${skill.applyRange}`;
  const tamanho = skill.applyAreaSize1 ? ` ${skill.applyAreaSize1}m` : "";
  const maximo = skill.applyTargetMax > 1 ? ` · até ${skill.applyTargetMax}` : "";
  return { area: true, text: `${forma}${tamanho} · ${quem}${maximo}` };
}

/** Dono da skill em uma linha; a lista completa fica no tooltip. */
function ownerSummary(flag: number) {
  const names = CLASS_NAMES.filter((_, index) => (flag & (1 << index)) !== 0);
  if (!names.length) return { short: "Sistema / sem classe", full: "Nenhuma classe de jogador" };
  if ((flag & ALL_CLASSES_FLAG) === ALL_CLASSES_FLAG) return { short: "Todas as classes", full: names.join(", ") };
  return { short: names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "), full: names.join(", ") };
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
  const [editing, setEditing] = useState<{ skill: SkillCatalogEntry; draft?: SkillDraft } | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState<SkillBatchPreview | null>(null);

  const loadBatch = useCallback(async () => {
    const response = await fetch("/api/skill-batch", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    setBatch(((await response.json()) as { batch: SkillBatchPreview }).batch);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadBatch(), 0); return () => window.clearTimeout(timer); }, [loadBatch]);
  const pendingTblidxs = new Set((batch?.items ?? []).map((item) => item.tblidx));

  /** Abre o editor já com o rascunho pendente da skill, se houver, para continuar de onde parou. */
  async function openEditor(skill: SkillCatalogEntry) {
    let draft: SkillDraft | undefined;
    if (pendingTblidxs.has(skill.tblidx)) {
      const response = await fetch("/api/skill-drafts", { cache: "no-store" }).catch(() => null);
      if (response?.ok) draft = ((await response.json()) as SkillDraftsResponse).drafts.find((entry) => entry.status === "draft" && entry.operation === "edit" && entry.newTblidx === skill.tblidx);
    }
    setEditing({ skill, draft });
  }

  /** O lote só conhece o TBLIDX; a ficha completa vem do catálogo. */
  async function openEditorByTblidx(tblidx: number) {
    const response = await fetch(`/api/skills?${new URLSearchParams({ search: String(tblidx), page: "1", pageSize: "200" })}`, { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as SkillCatalogResponse;
    const skill = body.skills?.find((entry) => entry.tblidx === tblidx);
    if (!skill) { setError(`A skill #${tblidx} não foi encontrada no catálogo.`); return; }
    setBatchOpen(false);
    await openEditor(skill);
  }

  function closeEditor() { setEditing(null); setCreating(false); void loadBatch(); }

  const loadSkills = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    // 40 fecha linhas inteiras na grade de 4 cards.
    const params = new URLSearchParams({ page: String(page), pageSize: "40" });
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

  if (creating) return <SkillDraftCreator onBack={closeEditor} />;
  if (editing) return <SkillDraftCreator key={editing.skill.tblidx} initialSkill={editing.skill} pendingDraft={editing.draft} onBack={closeEditor} />;
  if (batchOpen) return <SkillBatchPanel onBack={() => { setBatchOpen(false); void loadBatch(); void loadSkills(); }} onEdit={(tblidx) => void openEditorByTblidx(tblidx)} />;

  const blockedInBatch = (batch?.items ?? []).filter((item) => item.blockingIssues.length).length;

  return <div className="itemCatalogPanel">
    <form className="itemFilters skillFilters" onSubmit={submitSearch}>
      <div className="searchInputWrap"><span aria-hidden="true">⌕</span><input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Buscar por nome, TBLIDX ou ícone" maxLength={80} /></div>
      <select value={skillClass} onChange={(event) => { setSkillClass(event.target.value); setPage(1); }} aria-label="Filtrar classe da skill"><option value="">Ativas e passivas</option>{data?.availableSkillClasses.map((value) => <option key={value} value={value}>{label(SKILL_CLASS_NAMES, value, "Classe")}</option>)}</select>
      <select value={skillType} onChange={(event) => { setSkillType(event.target.value); setPage(1); }} aria-label="Filtrar tipo da skill"><option value="">Todos os tipos</option>{data?.availableSkillTypes.map((value) => <option key={value} value={value}>{label(SKILL_TYPE_NAMES, value, "Tipo")}</option>)}</select>
      <select value={characterClass} onChange={(event) => { setCharacterClass(event.target.value); setPage(1); }} aria-label="Filtrar classe de personagem"><option value="">Todas as classes</option>{CLASS_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
      <button className="primaryButton compact" type="submit">Buscar</button>
      {(search || skillClass || skillType || characterClass) && <button className="catalogClearButton" type="button" onClick={clearFilters}>Limpar</button>}
    </form>

    {batch && batch.items.length > 0 && <div className="skillBatchBar">
      <div className="skillBatchBarIcon" aria-hidden="true">{batch.items.length}</div>
      <div>
        <strong>{batch.items.length} skill{batch.items.length === 1 ? "" : "s"} com alterações pendentes</strong>
        <span>{batch.readyCount} pronta{batch.readyCount === 1 ? "" : "s"} · {batch.changeCount} campo{batch.changeCount === 1 ? "" : "s"}{blockedInBatch ? ` · ${blockedInBatch} com pendência` : ""} — exporte o pacote, aplique ou descarte de uma vez.</span>
      </div>
      <button type="button" className="primaryButton compact" onClick={() => setBatchOpen(true)}>Revisar lote</button>
    </div>}

    <div className="listHeader"><div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> skills encontradas</span></div><div className="catalogSource">{data && <span>{data.sourceFile} + {data.textSourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}<button className="refreshButton" onClick={() => void loadSkills()} disabled={loading}>↻ Atualizar</button><button className="primaryButton compact" onClick={() => setCreating(true)}>+ Criar habilidade</button></div></div>
    {error && <div className="errorBanner"><strong>Falha no catálogo</strong><span>{error}</span></div>}
    {loading && <div className="loadingState"><span className="spinner" /> Lendo o catálogo de skills...</div>}
    {!loading && data?.skills.length === 0 && <div className="emptyState">Nenhuma skill corresponde aos filtros.</div>}
    {!loading && data && data.skills.length > 0 && <div className="skillCardGrid">{data.skills.map((skill) => {
      const alvo = targetSummary(skill);
      const dono = ownerSummary(skill.classFlag);
      const pendente = pendingTblidxs.has(skill.tblidx);
      return <article key={skill.tblidx} className={`skillCard ${behaviorKind(skill)}${pendente ? " pending" : ""}`}>
        <div className="skillCardHead">
          <SkillIcon skill={skill} size={42} />
          <div className="skillCardTitle">
            <strong title={skill.name}>{skill.name}</strong>
            <span>#{skill.tblidx} · G{skill.grade}{skill.skillClass === 2 ? " · HTB" : ""}</span>
          </div>
          <div className="skillCardActions">
            <button type="button" className="skillCardButton" title="Ver detalhes" aria-label={`Ver detalhes de ${skill.name}`} onClick={() => setSelected(skill)}><Icon name="eye" size={16} /></button>
            <button type="button" className="skillCardButton edit" title={pendente ? "Continuar a edição pendente" : "Editar skill"} aria-label={`Editar ${skill.name}`} onClick={() => void openEditor(skill)}><Icon name="pencil" size={15} /></button>
          </div>
        </div>
        <div className="skillCardChips">
          {pendente && <span className="skillPendingBadge" title="Tem alterações pendentes no lote">no lote</span>}
          <span className="skillBehavior" title={`${label(SKILL_TYPE_NAMES, skill.skillType, "Tipo")} · ${skill.skillClass === 0 ? "Passiva" : label(ACTIVE_TYPE_NAMES, skill.activeType, "Efeito")}`}>{skill.skillClass === 0 ? "Passiva" : label(ACTIVE_TYPE_NAMES, skill.activeType, "Efeito")}</span>
          <span className={`skillTargetChip${alvo.area ? " area" : ""}`}><Icon name={alvo.area ? "area" : "target"} size={13} />{alvo.text}</span>
        </div>
        <div className="skillCardOwner" title={dono.full}><Icon name="user" size={13} /><span>{dono.short}</span></div>
        <dl className="skillCardFacts">
          <div><dt>Nível</dt><dd>{skill.requiredLevel}</dd></div>
          <div><dt>EP</dt><dd>{formatNumber(skill.requiredEp)}</dd></div>
          <div><dt>Recarga</dt><dd>{skill.cooldownMs ? `${formatNumber(skill.cooldownMs / 1000)}s` : "—"}</dd></div>
          <div><dt>Tipo</dt><dd>{label(SKILL_TYPE_NAMES, skill.skillType, "Tipo")}</dd></div>
        </dl>
      </article>;
    })}</div>}
    {data && <Pagination page={data.page} totalPages={data.totalPages} disabled={loading} onChange={setPage} label="Paginação do catálogo de skills" />}
    {selected && <SkillDetails skill={selected} onClose={() => setSelected(null)} onEdit={() => { setSelected(null); void openEditor(selected); }} />}
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
