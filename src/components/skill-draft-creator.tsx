"use client";

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DerivedOptionField, isEmptyReference, PrerequisiteEditor, SkillReferencePicker, SystemEffectPicker, type ResolvedSkill } from "@/components/skill-reference-fields";

import {
  getFieldsForSkillClass,
  getSkillCreationBaseValues,
  getSkillCreationProfile,
  SKILL_CREATION_PROFILES,
  RP_BONUS_SLOTS,
  SYSTEM_EFFECT_APPLY_TYPE_OPTIONS,
  type SkillCreationField,
  type SkillCreationGroup,
} from "@/lib/skill-creation-definitions";
import type { SkillCatalogEntry, SkillCatalogResponse, SkillDraft, SkillDraftsResponse, SkillDraftValue, SkillFieldOption, SkillFieldOptions, SkillPublishPreview, SystemEffectEntry } from "@/lib/types";

const GROUP_LABELS: Record<SkillCreationGroup, string> = {
  identity: "Identidade", classification: "Categoria e árvore", targeting: "Alvos e área",
  effects: "Efeitos e RP", requirements: "Custos e requisitos", timing: "Tempos e alcance",
  progression: "Progressão", animation: "Animações", advanced: "Avançado",
};
const GROUP_HELP: Record<SkillCreationGroup, string> = {
  identity: "Nome, ícone e identificadores", classification: "Quem aprende e como a skill se organiza", targeting: "Quem recebe o efeito e formato da área",
  effects: "Efeitos principais, bônus de RP e chance", requirements: "Custos para aprender e para usar", timing: "Casting, cooldown, duração e alcance",
  progression: "Liga esta grade às demais", animation: "Movimentos executados pelo cliente", advanced: "Campos perigosos; preserve a base se estiver em dúvida",
};

const CHARACTER_CLASSES = ["Lutador humano", "Místico humano", "Engenheiro humano", "Guerreiro Namek", "Místico Namek", "Mighty Majin", "Wonder Majin", "Street Fighter", "Sword Master", "Crane Roshi", "Turtle Roshi", "Gun Mania", "Mech Mania", "Dark Warrior", "Shadow Knight", "Dende Priest", "Poko Priest", "Ultimate Majin", "Grand Chef Majin", "Plasma Majin", "Karma Majin"];
const FUNCTION_FLAGS = [
  "Buff removido ao reconectar", "Somente com LP abaixo de 50%", "Ignorar tempo da animação", "Substituir buff do mesmo grupo",
  "Casting não interrompido por dano", "Cooldown controlado pelo servidor", "Exibir alvo para jogadores próximos", "Knockdown forçado",
  "Não pode ser alvo", "Não aplicar em si mesmo", "Parar ataque automático", "Invencível durante o uso",
  "Desmaiar após aplicar", "Dano cancela casting", "Invencível durante cooldown", "Invencível durante casting",
  "Imune a buff/debuff", "Sistema de sub-buff", "Duração infinita", "Ocultar ícone",
];
const EFFECT_APPLY_LABELS = new Map(SYSTEM_EFFECT_APPLY_TYPE_OPTIONS.map((option) => [option.value, option.label]));

function sameValue(left: SkillDraftValue | undefined, right: SkillDraftValue | undefined) { return JSON.stringify(left) === JSON.stringify(right); }

// Campos que não têm bloco próprio: aparecem dentro do editor do campo principal.
const COMPANION_FIELDS: Record<string, string[]> = { effectIds: ["effectIds", "effectTypes", "effectValues"], rpEffects: ["rpEffects", "rpEffectValues"] };
const HIDDEN_FIELDS = new Set(["effectTypes", "effectValues", "rpEffectValues"]);
const normalizeSearch = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const formatSeconds = (ms: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(ms / 1000)} s`;
function displayValue(value: SkillDraftValue | undefined) {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === "") return "—";
  return String(value);
}

function SkillBaseIcon({ skill, compact = false }: { skill: SkillCatalogEntry; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const className = `itemIconPlaceholder skillBaseIcon${compact ? " compact" : ""}`;
  if (!skill.iconName || failed) return <span className={className}>Sem ícone</span>;
  return <span className={`${className} itemIconLoaded`}><Image src={`/api/skills/icons/${encodeURIComponent(skill.iconName)}`} alt={`Ícone de ${skill.name}`} width={compact ? 44 : 64} height={compact ? 44 : 64} unoptimized onError={() => setFailed(true)} /></span>;
}

const SKILL_CLASS_LABELS: Record<number, string> = { 0: "Passiva", 1: "Ativa", 2: "HTB" };

function classesFromFlag(flag: number) {
  return CHARACTER_CLASSES.filter((_, index) => (flag & (1 << index)) !== 0);
}

function firstCharacterClass(flag: number) {
  const index = CHARACTER_CLASSES.findIndex((_, candidate) => (flag & (1 << candidate)) !== 0);
  return index >= 0 ? index : 0;
}

function editableValues(skill: SkillCatalogEntry) {
  const complete = getSkillCreationBaseValues(skill);
  return Object.fromEntries(getFieldsForSkillClass(skill.skillClass).map((field) => [field.id, complete[field.id]])) as Record<string, SkillDraftValue>;
}

function findSkillName(skills: SkillCatalogEntry[], tblidx: number) {
  if (!tblidx || tblidx === 0xffffffff) return "Nenhuma";
  const skill = skills.find((item) => item.tblidx === tblidx);
  return skill ? `#${tblidx} · ${skill.name} · Grade ${skill.grade}` : `#${tblidx} · fora do filtro atual`;
}

function SkillRelationshipSummary({ skill, skills }: { skill: SkillCatalogEntry; skills: SkillCatalogEntry[] }) {
  const allowedClasses = classesFromFlag(skill.classFlag);
  return <section className="skillRelationSummary">
    <div><small>Classes permitidas</small><strong>{allowedClasses.join(", ") || "Nenhuma"}</strong><span>Valor técnico: {skill.classFlag} · 0x{skill.classFlag.toString(16).toUpperCase()}</span></div>
    <div><small>Família da skill</small><strong>{skill.skillGroup === 255 ? "Sem grupo explícito" : `Grupo ${skill.skillGroup}`}</strong><span>Grade {skill.grade} · slot {skill.slotIndex}{skill.skillGroup === 255 ? " · progressão ligada pela próxima grade" : ""}</span></div>
    <div><small>Buff/debuff</small><strong>{skill.buffGroup === 255 ? "Sem grupo · pode empilhar" : `Grupo ${skill.buffGroup}`}</strong><span>{skill.buffGroup === 255 ? "Não procura buff anterior do mesmo grupo" : "Pode substituir outro efeito do mesmo grupo"}</span></div>
    <div><small>Progressão</small><strong>{findSkillName(skills, skill.rootSkillId)}</strong><span>Próxima: {findSkillName(skills, skill.nextSkillId)}</span></div>
  </section>;
}

/**
 * Valores com que o editor abre. Com um rascunho pendente, ele continua de onde parou em vez
 * de recomeçar do RDF -- era isso que espalhava várias versões parciais da mesma skill.
 */
function initialEditorValues(skill: SkillCatalogEntry | undefined, pendingDraft: SkillDraft | undefined) {
  if (!skill) return {};
  return pendingDraft ? { ...editableValues(skill), ...pendingDraft.values } : editableValues(skill);
}

export function SkillDraftCreator({ onBack, initialSkill, pendingDraft }: { onBack: () => void; initialSkill?: SkillCatalogEntry; pendingDraft?: SkillDraft }) {
  const router = useRouter();
  const editMode = Boolean(initialSkill);
  const [skillClass, setSkillClass] = useState(initialSkill?.skillClass ?? 1);
  const [characterClass, setCharacterClass] = useState(initialSkill ? firstCharacterClass(initialSkill.classFlag) : 0);
  const [baseSearch, setBaseSearch] = useState("");
  const [bases, setBases] = useState<SkillCatalogEntry[]>([]);
  const [baseSkill, setBaseSkill] = useState<SkillCatalogEntry | null>(initialSkill ?? null);
  const [baseValues, setBaseValues] = useState<Record<string, SkillDraftValue>>(() => initialSkill ? editableValues(initialSkill) : {});
  const [values, setValues] = useState<Record<string, SkillDraftValue>>(() => initialEditorValues(initialSkill, pendingDraft));
  const [drafts, setDrafts] = useState<SkillDraft[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validatingDraftId, setValidatingDraftId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishPreview, setPublishPreview] = useState<SkillPublishPreview | null>(null);
  const [publishAcknowledged, setPublishAcknowledged] = useState(false);
  const [replaceClientPack, setReplaceClientPack] = useState(false);
  const [clientPackDirectory, setClientPackDirectory] = useState("");
  const [prepareDownload, setPrepareDownload] = useState(false);
  const [packDownloadDraftId, setPackDownloadDraftId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Campos sem enum no servidor viram lista a partir dos valores que a tabela usa, e os
  // campos de referencia precisam do nome do que ja esta gravado -- que pode apontar para
  // fora da familia carregada na tela.
  const [fieldOptions, setFieldOptions] = useState<SkillFieldOptions>({});
  const [resolvedSkills, setResolvedSkills] = useState<Map<number, ResolvedSkill>>(new Map());
  const [resolvedEffects, setResolvedEffects] = useState<Map<number, SystemEffectEntry>>(new Map());
  // Navegação dentro do formulário: filtro por texto, "só alterados" e grupos recolhidos.
  const [fieldFilter, setFieldFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<SkillCreationGroup>>(new Set());
  // Valores no último salvamento, para saber se há algo ainda não salvo.
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialEditorValues(initialSkill, pendingDraft)));
  const [lastSavedDraft, setLastSavedDraft] = useState<SkillDraft | null>(pendingDraft ?? null);
  const formRef = useRef<HTMLFormElement>(null);

  const profile = getSkillCreationProfile(skillClass);
  const fields = useMemo(() => getFieldsForSkillClass(skillClass), [skillClass]);
  const groupedFields = useMemo(() => Object.entries(GROUP_LABELS).map(([group, label]) => ({
    group: group as SkillCreationGroup, label, fields: fields.filter((field) => field.group === group),
  })).filter((section) => section.fields.length), [fields]);
  const changedFields = useMemo(() => fields.filter((field) => !sameValue(values[field.id], baseValues[field.id])), [baseValues, fields, values]);
  const changedIds = useMemo(() => new Set(changedFields.map((field) => field.id as string)), [changedFields]);
  const fieldChanged = useCallback((id: string) => (COMPANION_FIELDS[id] ?? [id]).some((companion) => changedIds.has(companion)), [changedIds]);
  const unsaved = changedFields.length > 0 && JSON.stringify(values) !== savedSnapshot;

  const termo = normalizeSearch(fieldFilter.trim());
  const filtering = Boolean(termo) || onlyChanged;
  const visibleSections = useMemo(() => groupedFields.map((section) => ({
    ...section,
    changes: section.fields.filter((field) => changedIds.has(field.id)).length,
    fields: section.fields.filter((field) => !HIDDEN_FIELDS.has(field.id)
      && (!onlyChanged || fieldChanged(field.id))
      && (!termo || normalizeSearch(`${field.label} ${field.sourceField} ${field.help ?? ""}`).includes(termo))),
  })).filter((section) => section.fields.length), [changedIds, fieldChanged, groupedFields, onlyChanged, termo]);

  function jumpToGroup(group: SkillCreationGroup) {
    setClosedGroups((current) => { const next = new Set(current); next.delete(group); return next; });
    window.requestAnimationFrame(() => document.getElementById(`skill-group-${group}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function setGroupOpen(group: SkillCreationGroup, open: boolean) {
    setClosedGroups((current) => { const next = new Set(current); if (open) next.delete(group); else next.add(group); return next; });
  }
  function revertField(id: string) {
    setValues((current) => ({ ...current, [id]: baseValues[id] }));
  }
  function leave() {
    if (unsaved && !window.confirm("Há alterações que ainda não foram salvas como rascunho. Sair mesmo assim?")) return;
    onBack();
  }

  // Ctrl+S salva o rascunho sem precisar ir até o botão.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadDrafts = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/skill-drafts", { signal, cache: "no-store" });
    if (response.status === 401) { router.push("/login"); return; }
    const body = (await response.json().catch(() => ({}))) as SkillDraftsResponse | { error?: string };
    if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao consultar rascunhos.");
    setDrafts((body as SkillDraftsResponse).drafts);
  }, [router]);

  const loadBases = useCallback(async (signal?: AbortSignal) => {
    setLoadingBases(true);
    try {
      const params = new URLSearchParams({ skillClass: String(skillClass), characterClass: String(characterClass), page: "1", pageSize: "3000" });
      if (baseSearch.trim()) params.set("search", baseSearch.trim());
      const response = await fetch(`/api/skills?${params}`, { signal, cache: "no-store" });
      if (response.status === 401) { router.push("/login"); return; }
      const body = (await response.json().catch(() => ({}))) as SkillCatalogResponse | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao consultar skills-base.");
      setBases((body as SkillCatalogResponse).skills);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao consultar skills-base.");
    } finally { if (!signal?.aborted) setLoadingBases(false); }
  }, [baseSearch, characterClass, router, skillClass]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadDrafts(controller.signal).catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao consultar rascunhos.")), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadDrafts]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadBases(controller.signal), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadBases]);

  const loadFieldOptions = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/skills/field-options", { signal, cache: "no-store" });
    if (!response.ok) return;
    setFieldOptions(((await response.json()) as { options: SkillFieldOptions }).options);
  }, []);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void loadFieldOptions(controller.signal).catch(() => undefined), 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [loadFieldOptions]);

  // Resolve nome e icone de tudo que os campos de referencia apontam hoje.
  const referencedSkillIds = useMemo(() => {
    const ids = new Set<number>();
    for (const raw of [values.rootSkillId, values.nextSkillId]) if (typeof raw === "number" && !isEmptyReference(raw)) ids.add(raw);
    if (Array.isArray(values.prerequisiteSkillIds)) for (const id of values.prerequisiteSkillIds) if (!isEmptyReference(id)) ids.add(id);
    return [...ids];
  }, [values.nextSkillId, values.prerequisiteSkillIds, values.rootSkillId]);

  const referencedEffectIds = useMemo(() => (Array.isArray(values.effectIds) ? values.effectIds.filter((id) => !isEmptyReference(id)) : []), [values.effectIds]);

  useEffect(() => {
    const pending = referencedSkillIds.filter((id) => !resolvedSkills.has(id));
    if (!pending.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/skills/lookup?ids=${pending.join(",")}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { skills: ResolvedSkill[] };
        setResolvedSkills((current) => { const next = new Map(current); for (const skill of body.skills) next.set(skill.tblidx, skill); return next; });
      } catch { /* abortado */ }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [referencedSkillIds, resolvedSkills]);

  useEffect(() => {
    const pending = referencedEffectIds.filter((id) => !resolvedEffects.has(id));
    if (!pending.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/system-effects?ids=${pending.join(",")}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { effects: SystemEffectEntry[] };
        setResolvedEffects((current) => { const next = new Map(current); for (const effect of body.effects) next.set(effect.tblidx, effect); return next; });
      } catch { /* abortado */ }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [referencedEffectIds, resolvedEffects]);

  function changeCategory(rawValue: string) {
    setSkillClass(Number(rawValue)); setBaseSkill(null); setBaseValues({}); setValues({});
    setBaseSearch(""); setError(""); setMessage("");
  }

  function changeCharacterClass(rawValue: string) {
    setCharacterClass(Number(rawValue)); setBaseSkill(null); setBaseValues({}); setValues({});
    setBaseSearch(""); setError(""); setMessage("");
  }

  function selectBase(rawValue: string) {
    const selected = bases.find((skill) => skill.tblidx === Number(rawValue)) ?? null;
    setBaseSkill(selected); setError(""); setMessage("");
    if (!selected) { setBaseValues({}); setValues({}); return; }
    const completeBase = getSkillCreationBaseValues(selected);
    const applicable = Object.fromEntries(fields.map((field) => [field.id, completeBase[field.id]])) as Record<string, SkillDraftValue>;
    setBaseValues(applicable);
    const iniciais = {
      ...applicable, tblidx: 0, skillClass, classFlag: 1 << characterClass,
      name: `${selected.name} - Nova`,
      internalName: `${selected.internalName || `SKILL_${selected.tblidx}`}_NEW`.slice(0, 40),
    };
    setValues(iniciais);
    // Os ajustes automáticos da clonagem não contam como "não salvo"; só o que vier depois.
    setSavedSnapshot(JSON.stringify(iniciais));
    setLastSavedDraft(null);
  }

  function changeField(metadata: SkillCreationField, rawValue: string | boolean) {
    let value: SkillDraftValue;
    if (metadata.control === "checkbox") value = Boolean(rawValue);
    else if (metadata.control === "number-list") value = String(rawValue).split(",").map((part) => Number(part.trim())).filter(Number.isFinite);
    else if (["number", "select", "bitflag", "reference"].includes(metadata.control)) value = rawValue === "" ? 0 : Number(rawValue);
    else value = String(rawValue);
    setValues((current) => ({ ...current, [metadata.id]: value }));
  }

  function changeFields(nextValues: Record<string, SkillDraftValue>) {
    setValues((current) => ({ ...current, ...nextValues }));
  }

  const canSave = Boolean(baseSkill) && !saving && Number(values.tblidx) >= 1 && Boolean(String(values.name ?? "").trim()) && !(editMode && changedFields.length === 0);

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    // O Ctrl+S chega aqui mesmo com o botão desabilitado, então a regra do botão é refeita.
    if (!baseSkill || !canSave) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/skill-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: editMode ? "edit" : "create", skillClass, characterClass, baseTblidx: baseSkill.tblidx, newTblidx: Number(values.tblidx), name: String(values.name ?? ""), values }),
      });
      const body = (await response.json().catch(() => ({}))) as { draft?: SkillDraft; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o rascunho.");
      setMessage(editMode
        ? `Skill ${body.draft?.newTblidx} salva no lote de alterações. Volte ao catálogo e use "Revisar lote" para exportar ou aplicar junto com as outras.`
        : `Criação da skill ${body.draft?.newTblidx} salva como rascunho. Nenhum arquivo do jogo foi alterado.`);
      setSavedSnapshot(JSON.stringify(values));
      setLastSavedDraft(body.draft ?? null);
      await loadDrafts();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o rascunho."); }
    finally { setSaving(false); }
  }

  async function validatePublication(draft: SkillDraft) {
    setValidatingDraftId(draft.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/skill-drafts/${encodeURIComponent(draft.id)}/publish`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { preview?: SkillPublishPreview; error?: string };
      if (response.status === 401) { router.push("/login"); return; }
      if (!response.ok || !body.preview) throw new Error(body.error ?? "Não foi possível validar a publicação.");
      setPublishPreview(body.preview); setPublishAcknowledged(false);
      setReplaceClientPack(false); setPrepareDownload(false); setClientPackDirectory(body.preview.defaultClientPackDirectory);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível validar a publicação."); }
    finally { setValidatingDraftId(""); }
  }

  async function confirmPublication() {
    if (!publishPreview?.confirmationToken || !publishAcknowledged) return;
    setPublishing(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/skill-drafts/${encodeURIComponent(publishPreview.draftId)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationToken: publishPreview.confirmationToken,
          replaceClientPack,
          clientPackDirectory: replaceClientPack || prepareDownload ? clientPackDirectory : null,
          prepareDownload,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        result?: { backupPath?: string; clientPack?: { replaced?: { fileName: string; packPath: string } | null; download?: { fileName: string; draftId: string } | null } };
        error?: string;
      };
      if (response.status === 401) { router.push("/login"); return; }
      if (!response.ok) throw new Error(body.error ?? "Não foi possível publicar a skill.");
      const clientPack = body.result?.clientPack;
      setMessage(
        [
          `Skill #${publishPreview.tblidx} publicada no RDF do servidor. Backup: ${body.result?.backupPath ?? "criado"}. Reinicie o GameServer.`,
          clientPack?.replaced ? `Pack do cliente substituído em ${clientPack.replaced.packPath}.` : "O pack do cliente não foi alterado.",
          clientPack?.download ? `${clientPack.download.fileName} pronto para download.` : "",
        ].filter(Boolean).join(" "),
      );
      setPackDownloadDraftId(clientPack?.download ? clientPack.download.draftId : "");
      setPublishPreview(null); setPublishAcknowledged(false); setLastSavedDraft(null);
      await loadDrafts();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível publicar a skill."); }
    finally { setPublishing(false); }
  }

  const draftsDestaSkill = editMode && baseSkill ? drafts.filter((draft) => draft.newTblidx === baseSkill.tblidx) : drafts;
  const outrosDrafts = editMode && baseSkill ? drafts.filter((draft) => draft.newTblidx !== baseSkill.tblidx) : [];
  const renderDraft = (draft: SkillDraft) => <article key={draft.id} className={draft.status === "published" ? "published" : ""}><div><strong>{draft.name}</strong><span>{draft.operation === "edit" ? "Edição" : "Criação"} · #{draft.newTblidx} · {draft.profile} · {CHARACTER_CLASSES[draft.characterClass] ?? `Classe ${draft.characterClass}`}</span></div><small>Base #{draft.baseTblidx} · {draft.changedFields.length} alterações · {new Date(draft.updatedAt).toLocaleString("pt-BR")}</small>{draft.status === "published" ? <div className="draftPublishedStatus"><strong>Publicado no RDF</strong><span>{draft.publishedAt ? new Date(draft.publishedAt).toLocaleString("pt-BR") : ""}</span></div> : <button className="publishDraftButton" type="button" disabled={validatingDraftId === draft.id} onClick={() => void validatePublication(draft)}>{validatingDraftId === draft.id ? "Validando..." : "Validar e publicar"}</button>}</article>;

  return <div className="itemDraftCreator">
    <div className="draftCreatorHeader">
      <div><div className="eyebrow">{editMode ? "EDITAR HABILIDADE" : "CRIAR HABILIDADE"}</div><h2>{editMode ? "Editar habilidade" : "Criar habilidade"}</h2><p>{!editMode ? "Escolha uma categoria e clone uma habilidade estruturalmente compatível."
        : pendingDraft ? `Continuando o rascunho pendente desta skill (salvo em ${new Date(pendingDraft.updatedAt).toLocaleString("pt-BR")}). Ele faz parte do lote de alterações.`
        : "Salvar adiciona esta skill ao lote de alterações; nada muda no jogo até você aplicar ou exportar."}</p></div>
      <button className="catalogClearButton" type="button" onClick={leave}>← Voltar ao catálogo</button>
    </div>

    {/* Categoria, classe e base só servem para criar; na edição ficavam desativadas ocupando a tela. */}
    {!editMode && <>
      <div className="draftSafetyBanner"><strong>Nenhuma publicação automática</strong><span>Salvar cria somente um JSON auditável de criação. RDF, textos, ícones, cliente e servidor permanecem intactos.</span></div>
      <section className="draftSetupGrid skillDraftSetupGrid">
        <label><span>1. Categoria</span><select value={skillClass} onChange={(event) => changeCategory(event.target.value)}>{SKILL_CREATION_PROFILES.map((item) => <option key={item.skillClass} value={item.skillClass}>{item.label} ({item.skillClass})</option>)}</select></label>
        <label><span>2. Classe de referência</span><select value={characterClass} onChange={(event) => changeCharacterClass(event.target.value)}>{CHARACTER_CLASSES.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label><span>Buscar skill-base</span><input value={baseSearch} onChange={(event) => setBaseSearch(event.target.value)} placeholder="Nome ou TBLIDX" maxLength={80} /></label>
        <label><span>3. Skill-base ({bases.length} disponíveis)</span><select value={baseSkill?.tblidx ?? ""} onChange={(event) => selectBase(event.target.value)} disabled={loadingBases}><option value="">{loadingBases ? "Carregando todas..." : "Selecione uma habilidade"}</option>{bases.map((skill) => <option key={skill.tblidx} value={skill.tblidx}>#{skill.tblidx} · {skill.name} · Grade {skill.grade}</option>)}</select></label>
      </section>
    </>}

    {baseSkill && (editMode
      ? <section className="skillEditHero">
          <SkillBaseIcon skill={baseSkill} />
          <div className="skillEditHeroInfo">
            <strong>{baseSkill.name}</strong>
            <span>#{baseSkill.tblidx} · {baseSkill.iconName || "sem ícone"}</span>
            <div className="skillEditHeroBadges">
              <span className="catalogBadge">{SKILL_CLASS_LABELS[baseSkill.skillClass] ?? `Categoria ${baseSkill.skillClass}`}</span>
              <span className="rankBadge">Grade {baseSkill.grade}</span>
              <span className="rankBadge">{fields.length} campos</span>
            </div>
          </div>
          <SkillRelationshipSummary skill={baseSkill} skills={bases} />
        </section>
      : <>
          <section className="skillBaseCard">
            <SkillBaseIcon skill={baseSkill} />
            <div><div className="eyebrow">SKILL-BASE SELECIONADA</div><strong>{baseSkill.name}</strong><span>#{baseSkill.tblidx} · {baseSkill.iconName || "Sem ícone informado"}</span><small>A nova habilidade começa usando este mesmo ícone. O campo Ícone pode ser alterado depois.</small></div>
          </section>
          <SkillRelationshipSummary skill={baseSkill} skills={bases} />
        </>)}

    {!editMode && profile && <div className="profileSummary"><div><strong>{profile.label}</strong><span>{profile.notes}</span></div><span>{fields.length} campos aplicáveis</span></div>}
    {error && <div className="errorBanner"><strong>Não foi possível continuar</strong><span>{error}</span></div>}
    {message && <div className="successBanner"><strong>Rascunho registrado</strong><span>{message}</span>{packDownloadDraftId && <a className="packDownloadLink" href={`/api/client-pack?draft=${encodeURIComponent(packDownloadDraftId)}`} download>Baixar pack do cliente</a>}</div>}

    {!baseSkill ? <div className="draftEmptyState">Selecione uma skill-base para abrir os campos da categoria.</div> : <form ref={formRef} onSubmit={saveDraft}>
      <div className="draftWorkspace">
        <div className="draftFields">
          {/* Barra que acompanha a rolagem: filtro, "só alterados" e atalho para cada grupo. */}
          <div className="skillFieldToolbar">
            <div className="skillFieldToolbarRow">
              <div className="searchInputWrap"><span aria-hidden="true">⌕</span>
                <input value={fieldFilter} onChange={(event) => setFieldFilter(event.target.value)} placeholder="Filtrar campos: cooldown, EP, alvo, ícone…" maxLength={60} aria-label="Filtrar campos" /></div>
              <label className={`skillOnlyChanged${onlyChanged ? " on" : ""}`}>
                <input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} />
                <span>Só alterados <b>{changedFields.length}</b></span></label>
              <button type="button" className="catalogClearButton" disabled={filtering}
                onClick={() => setClosedGroups(closedGroups.size ? new Set() : new Set(groupedFields.map((section) => section.group)))}>
                {closedGroups.size ? "Expandir tudo" : "Recolher tudo"}</button>
            </div>
            <nav className="skillGroupNav" aria-label="Grupos de campos">
              {visibleSections.map((section) => <button key={section.group} type="button" onClick={() => jumpToGroup(section.group)}>
                {section.label}{section.changes > 0 && <b>{section.changes}</b>}</button>)}
            </nav>
          </div>

          {visibleSections.map((section) => <details id={`skill-group-${section.group}`} className="draftFieldGroup" key={section.group}
            open={filtering || !closedGroups.has(section.group)}
            onToggle={(event) => { if (!filtering) setGroupOpen(section.group, event.currentTarget.open); }}>
            <summary><div><strong>{section.label}</strong><small>{GROUP_HELP[section.group]}</small></div>
              <span>{section.changes > 0 && <b className="groupChangeCount">{section.changes} alterad{section.changes === 1 ? "o" : "os"}</b>}{section.fields.length} campos</span></summary>
            <div className="draftFieldGrid">{section.fields.map((metadata) => <SkillDraftField key={metadata.id} metadata={metadata} value={values[metadata.id]} allValues={values} changed={fieldChanged(metadata.id)} relatedSkills={bases} requiredCharacterClass={editMode ? -1 : characterClass} lockTblidx={editMode} onChange={(value) => changeField(metadata, value)} onChangeMany={changeFields} resolvedSkills={resolvedSkills} resolvedEffects={resolvedEffects} derivedOptions={fieldOptions[metadata.id]} onResolveSkill={(skill) => setResolvedSkills((current) => new Map(current).set(skill.tblidx, skill))} onResolveEffect={(effect) => setResolvedEffects((current) => new Map(current).set(effect.tblidx, effect))} />)}</div>
          </details>)}
          {!visibleSections.length && <div className="draftEmptyState">{onlyChanged && !termo ? "Nenhum campo alterado ainda." : "Nenhum campo corresponde ao filtro."}</div>}
        </div>

        <aside className="draftDiffPanel">
          <div className="skillDraftPreviewIdentity">
            {/* key: um ícone que falhou não pode impedir o próximo de aparecer. */}
            <SkillBaseIcon key={String(values.iconName ?? "")} skill={{ ...baseSkill, iconName: String(values.iconName ?? baseSkill.iconName) }} compact />
            <div><div className="eyebrow">PRÉ-VISUALIZAÇÃO</div><h3>{String(values.name || "Nova habilidade")}</h3>
              <p>{editMode ? `Editando #${displayValue(values.tblidx)}` : `Nova #${displayValue(values.tblidx)} baseada em #${baseSkill.tblidx}`}</p></div>
          </div>
          <div className="draftDiffHeader">
            <strong>{changedFields.length} alteraç{changedFields.length === 1 ? "ão" : "ões"}</strong>
            {editMode && changedFields.length > 0 && <button type="button" className="skillRevertAll" onClick={() => setValues({ ...baseValues })}>Desfazer tudo</button>}
          </div>
          <div className="draftDiffList">{changedFields.map((metadata) => <div key={metadata.id}>
            <header><span>{metadata.label}</span>
              <button type="button" className="skillRevertField" title="Voltar este campo ao valor original" aria-label={`Desfazer ${metadata.label}`} onClick={() => revertField(metadata.id)}>↺</button></header>
            <small>{describeFieldValue(metadata.id, baseValues[metadata.id], resolvedSkills, resolvedEffects)}</small>
            <strong>→ {describeFieldValue(metadata.id, values[metadata.id], resolvedSkills, resolvedEffects)}</strong>
          </div>)}</div>
          {!changedFields.length && <p className="muted">Nenhum campo foi alterado.</p>}
          {unsaved ? <p className="draftSaveState unsaved">● Alterações não salvas <kbd>Ctrl S</kbd></p>
            : lastSavedDraft ? <p className="draftSaveState">✓ Rascunho salvo</p> : null}
          <button className="primaryButton" disabled={!canSave}>{saving ? "Salvando..." : editMode ? "Salvar edição como rascunho" : "Salvar rascunho JSON"}</button>
          {/* O passo seguinte fica aqui mesmo, sem precisar procurar o rascunho no fim da página. */}
          {lastSavedDraft && !unsaved && lastSavedDraft.status !== "published" && <button className="publishDraftButton" type="button"
            disabled={validatingDraftId === lastSavedDraft.id} onClick={() => void validatePublication(lastSavedDraft)}>
            {validatingDraftId === lastSavedDraft.id ? "Validando..." : "Validar e publicar este rascunho"}</button>}
        </aside>
      </div>
    </form>}

    <section className="savedDrafts">
      <div className="serverSectionHeader"><div><strong>{editMode ? "Rascunhos desta skill" : "Rascunhos salvos"}</strong><span>Valide as diferenças antes de publicar no RDF do servidor</span></div><span>{draftsDestaSkill.length}</span></div>
      {draftsDestaSkill.length === 0 ? <p className="muted">{editMode ? "Nenhum rascunho desta skill ainda." : "Nenhum rascunho criado."}</p> : <div className="savedDraftGrid">{draftsDestaSkill.map(renderDraft)}</div>}
      {outrosDrafts.length > 0 && <details className="otherDrafts"><summary>Rascunhos de outras skills ({outrosDrafts.length})</summary><div className="savedDraftGrid">{outrosDrafts.map(renderDraft)}</div></details>}
    </section>
    {publishPreview && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (!publishing && event.target === event.currentTarget) setPublishPreview(null); }}><section className="editorModal skillPublishModal" role="dialog" aria-modal="true" aria-labelledby="skill-publish-title"><div className="modalHeader"><div><div className="eyebrow">CONFIRMAÇÃO OBRIGATÓRIA</div><h2 id="skill-publish-title">Publicar {publishPreview.skillName}</h2><p>Skill #{publishPreview.tblidx}</p></div><button className="closeButton" disabled={publishing} onClick={() => setPublishPreview(null)} aria-label="Fechar">×</button></div><div className="publishDestination"><small>Arquivo que será alterado</small><code>{publishPreview.rdfPath}</code></div><div className="publishChangeList"><div className="publishChangeHeader"><strong>Mudanças confirmadas</strong><span>{publishPreview.changes.length}</span></div>{publishPreview.changes.map((change) => <div key={change.id}><span><strong>{change.label}</strong><small>{change.sourceField}</small></span><code>{describeFieldValue(change.id, change.before, resolvedSkills, resolvedEffects)}</code><b>→</b><code>{describeFieldValue(change.id, change.after, resolvedSkills, resolvedEffects)}</code></div>)}</div>{publishPreview.blockingIssues.length > 0 && <div className="errorBanner"><strong>Publicação bloqueada</strong><span>{publishPreview.blockingIssues.join(" ")}</span></div>}<div className="publishWarnings">{publishPreview.warnings.map((warning) => <span key={warning}>⚠ {warning}</span>)}</div><div className="publishClientOptions"><strong>Cópia do cliente</strong><label><input type="checkbox" checked={replaceClientPack} onChange={(event) => setReplaceClientPack(event.target.checked)} /><span>Substituir automaticamente o pack do cliente</span></label><label><input type="checkbox" checked={prepareDownload} onChange={(event) => setPrepareDownload(event.target.checked)} /><span>Gerar o pack corrigido para download</span></label>{(replaceClientPack || prepareDownload) && <label className="publishPackPath"><span>Pasta pack do cliente</span><input type="text" value={clientPackDirectory} onChange={(event) => setClientPackDirectory(event.target.value)} spellCheck={false} placeholder="C:\\...\\ClientRuntime_RealBase\\pack" /></label>}{!replaceClientPack && !prepareDownload && <small className="muted">Sem nenhuma das duas, só o RDF do servidor muda e o cliente continua com o valor antigo.</small>}</div>{publishPreview.confirmationToken && <label className="publishAcknowledgement"><input type="checkbox" checked={publishAcknowledged} onChange={(event) => setPublishAcknowledged(event.target.checked)} /><span>Revisei os valores acima e confirmo a gravação no RDF do servidor.</span></label>}<div className="modalActions"><button className="catalogClearButton" type="button" disabled={publishing} onClick={() => setPublishPreview(null)}>Cancelar</button><button className="dangerPublishButton" type="button" disabled={publishing || !publishAcknowledged || !publishPreview.confirmationToken} onClick={() => void confirmPublication()}>{publishing ? "Publicando..." : "Confirmar publicação no RDF"}</button></div></section></div>}
  </div>;
}

const EMPTY_REF = 4294967295;

/**
 * Formata o valor de um campo para leitura humana.
 *
 * Os campos de referencia guardam TBLIDX, e mostrar "4294967295 -> 110211" no resumo de
 * alteracoes obrigava o operador a traduzir de cabeca justamente na hora de conferir o que
 * vai para o RDF. Aqui o numero vira nome sempre que o catalogo ja o resolveu.
 */
function describeFieldValue(fieldId: string, value: SkillDraftValue | undefined, skills: Map<number, ResolvedSkill>, effects: Map<number, SystemEffectEntry>): string {
  const skillName = (id: number) => isEmptyReference(id) ? "nenhuma" : skills.get(id)?.name ? `${skills.get(id)!.name} (#${id})` : `#${id}`;
  if (fieldId === "rootSkillId" || fieldId === "nextSkillId") return skillName(Number(value ?? EMPTY_REF));
  if (fieldId === "prerequisiteSkillIds" && Array.isArray(value)) {
    return [0, 1].map((pair) => {
      const min = value[pair * 2] ?? EMPTY_REF;
      const max = value[pair * 2 + 1] ?? EMPTY_REF;
      if (isEmptyReference(min) && isEmptyReference(max)) return `par ${pair + 1}: sem exigência`;
      return `par ${pair + 1}: ${skillName(min)} até ${skillName(max)}`;
    }).join(" · ");
  }
  if (fieldId === "effectIds" && Array.isArray(value)) {
    return value.map((id) => isEmptyReference(id) ? "vazio" : effects.get(id)?.name ?? `#${id}`).join(" · ");
  }
  return displayValue(value);
}

function SkillDraftField({ metadata, value, allValues, changed, relatedSkills, requiredCharacterClass, lockTblidx, onChange, onChangeMany, resolvedSkills, resolvedEffects, derivedOptions, onResolveSkill, onResolveEffect }: { metadata: SkillCreationField; value: SkillDraftValue | undefined; allValues: Record<string, SkillDraftValue>; changed: boolean; relatedSkills: SkillCatalogEntry[]; requiredCharacterClass: number; lockTblidx: boolean; onChange: (value: string | boolean) => void; onChangeMany: (values: Record<string, SkillDraftValue>) => void; resolvedSkills: Map<number, ResolvedSkill>; resolvedEffects: Map<number, SystemEffectEntry>; derivedOptions?: SkillFieldOption[]; onResolveSkill: (skill: ResolvedSkill) => void; onResolveEffect: (effect: SystemEffectEntry) => void }) {
  const className = changed ? "draftField changed" : "draftField";
  if (metadata.id === "rpEffectValues") return null;
  if (metadata.id === "rpEffects") return <RpBonusEditor metadata={metadata} types={Array.isArray(value) ? value : []} values={Array.isArray(allValues.rpEffectValues) ? allValues.rpEffectValues : []} changed={changed} onChange={(types, values) => onChangeMany({ rpEffects: types, rpEffectValues: values })} />;
  if (metadata.id === "effectTypes" || metadata.id === "effectValues") return null;
  if (metadata.id === "effectIds") return <EffectEditor metadata={metadata} ids={Array.isArray(value) ? value : []} types={Array.isArray(allValues.effectTypes) ? allValues.effectTypes : []} values={Array.isArray(allValues.effectValues) ? allValues.effectValues : []} changed={changed} onChange={onChangeMany} resolved={resolvedEffects} onResolve={onResolveEffect} />;
  if (metadata.id === "prerequisiteSkillIds") return <PrerequisiteEditor ids={Array.isArray(value) ? value : []} resolved={resolvedSkills} changed={changed} onChange={(ids) => onChangeMany({ prerequisiteSkillIds: ids })} onResolve={onResolveSkill} />;
  if (metadata.control === "reference") return <div className={`${className} skillRefField`}><span>{metadata.label}</span>
    <SkillReferencePicker value={Number(value ?? EMPTY_REF)} resolved={resolvedSkills} label={metadata.label} onPick={(tblidx) => onChange(String(tblidx))} onResolve={onResolveSkill} />
    <small>{metadata.sourceField}{metadata.help ? ` · ${metadata.help}` : ""}</small></div>;
  if (derivedOptions?.length) return <DerivedOptionField label={metadata.label} sourceField={metadata.sourceField} help={metadata.help} value={Number(value ?? 0)} options={derivedOptions} changed={changed} onChange={onChange} />;
  if (metadata.id === "classFlag") return <ClassFlagField metadata={metadata} value={Number(value ?? 0)} changed={changed} requiredCharacterClass={requiredCharacterClass} onChange={onChange} />;
  if (metadata.id === "functionFlag") return <FunctionFlagField metadata={metadata} value={Number(value ?? 0)} changed={changed} onChange={onChange} />;
  // Nome técnico do RDF à direita do rótulo, discreto: útil para conferir, sem disputar
  // atenção com a explicação do campo.
  const labelRow = <span className="fieldLabelRow"><span>{metadata.label}{metadata.required ? " *" : ""}</span><code title="Campo no RDF">{metadata.sourceField}</code></span>;
  if (metadata.control === "checkbox") return <label className={`${className} checkboxField`}><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span><strong>{metadata.label}</strong><small>{metadata.sourceField}{metadata.help ? ` · ${metadata.help}` : ""}</small></span></label>;
  if (metadata.control === "select" && metadata.options) return <label className={className}>{labelRow}<select value={Number(value ?? 0)} disabled={metadata.locked} onChange={(event) => onChange(event.target.value)}>{metadata.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.value})</option>)}</select>{(metadata.help || metadata.locked) && <small>{metadata.locked ? "Definido pela categoria." : metadata.help}</small>}</label>;
  const inputType = metadata.control === "text" || metadata.control === "number-list" ? "text" : "number";
  const relation = relationText(metadata, value, relatedSkills);
  // Tempos ficam em milissegundos no RDF; a conversão ao lado evita a conta de cabeça.
  const emSegundos = metadata.id.endsWith("Ms") && typeof value === "number" ? (value ? formatSeconds(value) : "instantâneo") : "";
  return <label className={className}>{labelRow}<span className="fieldInputRow">{metadata.id === "description" ? <textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} maxLength={2000} /> : <input type={inputType} value={displayValue(value) === "—" ? "" : displayValue(value)} min={metadata.min} max={metadata.max} step={metadata.step} maxLength={metadata.control === "text" ? (metadata.id === "internalName" ? 40 : metadata.id === "iconName" ? 32 : 64) : undefined} disabled={lockTblidx && metadata.id === "tblidx"} onChange={(event) => onChange(event.target.value)} required={metadata.required} />}{emSegundos && <em className="fieldUnitHint">= {emSegundos}</em>}</span>
    {(metadata.help || metadata.control === "number-list") && <small>{metadata.control === "number-list" ? "Valores separados por vírgula. " : ""}{metadata.help}</small>}{relation && <span className="fieldRelationHint">{relation}</span>}</label>;
}

/**
 * Cada posicao de abyRpEffect e um slot fixo lido pelo servidor por indice. Por isso o editor
 * mostra uma linha por slot, com o significado ja escrito, em vez de seis campos livres onde
 * daria para colocar qualquer tipo em qualquer posicao. Ver RP_BONUS_SLOTS.
 */
function RpBonusEditor({ metadata, types, values, changed, onChange }: { metadata: SkillCreationField; types: number[]; values: number[]; changed: boolean; onChange: (types: number[], values: number[]) => void }) {
  const normalizedTypes = Array.from({ length: 6 }, (_, index) => types[index] ?? 255);
  const normalizedValues = Array.from({ length: 6 }, (_, index) => values[index] ?? 0);
  function changeType(index: number, next: number) { const updated = [...normalizedTypes]; updated[index] = next; onChange(updated, normalizedValues); }
  function changeValue(index: number, next: number) { const updated = [...normalizedValues]; updated[index] = next; onChange(normalizedTypes, updated); }
  const ativos = normalizedTypes.filter((type) => type !== 255).length;
  return <fieldset className={`draftField rpBonusField${changed ? " changed" : ""}`}><legend>Bônus de RP</legend>
    <p>Cada linha é uma posição fixa que o servidor lê pelo índice. Ligue as que esta skill oferece e informe o valor; a ordem não pode mudar.</p>
    <div className="rpBonusGrid">{RP_BONUS_SLOTS.map((slot) => {
      const type = normalizedTypes[slot.index];
      const ligado = type !== 255;
      return <div key={slot.index} className={ligado ? "rpBonusSlot on" : "rpBonusSlot"}>
        <strong>{slot.label}</strong>
        <select value={type} onChange={(event) => changeType(slot.index, Number(event.target.value))}>{slot.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <label><span>Valor ({slot.unit})</span><input type="number" step="any" disabled={!ligado} value={ligado ? normalizedValues[slot.index] : 0} onChange={(event) => changeValue(slot.index, Number(event.target.value))} /></label>
        <small>{slot.help}</small>
      </div>;
    })}</div>
    <small>{metadata.sourceField} + afRpEffectValue[6] · {ativos === 0 ? "Nenhum bônus ligado" : `${ativos} de 6 bônus ligados`} · Posições fixas de eDBO_RP_BONUS_SLOT; o servidor lê por índice.</small></fieldset>;
}

/**
 * bySkill_Effect_Type[2] diz como aSkill_Effect_Value[2] deve ser interpretado, entao os tres
 * campos aparecem juntos: efeito, forma de aplicar e valor, um bloco por efeito.
 */
function EffectEditor({ metadata, ids, types, values, changed, onChange, resolved, onResolve }: { metadata: SkillCreationField; ids: number[]; types: number[]; values: number[]; changed: boolean; onChange: (values: Record<string, SkillDraftValue>) => void; resolved: Map<number, SystemEffectEntry>; onResolve: (effect: SystemEffectEntry) => void }) {
  const VAZIO = 4294967295;
  const nIds = Array.from({ length: 2 }, (_, index) => ids[index] ?? VAZIO);
  const nTypes = Array.from({ length: 2 }, (_, index) => types[index] ?? 255);
  const nValues = Array.from({ length: 2 }, (_, index) => values[index] ?? 0);
  function change(campo: "effectIds" | "effectTypes" | "effectValues", index: number, next: number) {
    const base = campo === "effectIds" ? [...nIds] : campo === "effectTypes" ? [...nTypes] : [...nValues];
    base[index] = next;
    onChange({ [campo]: base });
  }
  return <fieldset className={`draftField effectField${changed ? " changed" : ""}`}><legend>Efeitos do sistema</legend>
    <p>Até dois efeitos de Table_System_Effect_Data, escolhidos pelo nome. A forma de aplicar define como o valor ao lado é lido.</p>
    <div className="effectSlotGrid">{nIds.map((id, index) => {
      const usado = id !== VAZIO && id !== 0;
      return <div key={index} className={usado ? "effectSlot on" : "effectSlot"}>
        <strong>Efeito {index + 1}</strong>
        <div className="effectSlotField"><span>Efeito</span><SystemEffectPicker value={id} resolved={resolved} onPick={(tblidx) => change("effectIds", index, tblidx)} onResolve={onResolve} /></div>
        <label><span>Como aplicar</span><select value={nTypes[index]} onChange={(event) => change("effectTypes", index, Number(event.target.value))}>{SYSTEM_EFFECT_APPLY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Valor</span><input type="number" step="any" value={nValues[index]} onChange={(event) => change("effectValues", index, Number(event.target.value))} /></label>
        <small>{usado ? `${EFFECT_APPLY_LABELS.get(nTypes[index]) ?? "Tipo desconhecido"} · o × ao lado do nome esvazia a posição` : "Espaço vazio"}</small>
      </div>;
    })}</div>
    <small>{metadata.sourceField} + bySkill_Effect_Type[2] + aSkill_Effect_Value[2] · Tipos de eSYSTEM_EFFECT_APPLY_TYPE.</small></fieldset>;
}

function ClassFlagField({ metadata, value, changed, requiredCharacterClass, onChange }: { metadata: SkillCreationField; value: number; changed: boolean; requiredCharacterClass: number; onChange: (value: string) => void }) {
  function toggle(index: number) { const bit = 1 << index; onChange(String((value & bit) !== 0 ? value & ~bit : value | bit)); }
  return <fieldset className={`draftField bitFlagField${changed ? " changed" : ""}`}><legend>{metadata.label}</legend><div className="bitFlagGrid">{CHARACTER_CLASSES.map((name, index) => <label key={name} className={(value & (1 << index)) !== 0 ? "selected" : ""}><input type="checkbox" checked={(value & (1 << index)) !== 0} disabled={index === requiredCharacterClass} onChange={() => toggle(index)} /><span>{name}</span><small>{1 << index}</small></label>)}</div><div className="bitFlagValue"><span>Selecionadas: {classesFromFlag(value).join(", ")}</span><code>{value} · 0x{value.toString(16).toUpperCase()}</code></div><small>{metadata.help}</small></fieldset>;
}

function FunctionFlagField({ metadata, value, changed, onChange }: { metadata: SkillCreationField; value: number; changed: boolean; onChange: (value: string) => void }) {
  function toggle(index: number) { const bit = 1 << index; onChange(String((value & bit) !== 0 ? value & ~bit : value | bit)); }
  return <fieldset className={`draftField bitFlagField${changed ? " changed" : ""}`}><legend>{metadata.label}</legend><div className="bitFlagGrid compact">{FUNCTION_FLAGS.map((name, index) => <label key={name} className={(value & (1 << index)) !== 0 ? "selected" : ""}><input type="checkbox" checked={(value & (1 << index)) !== 0} onChange={() => toggle(index)} /><span>{name}</span><small>bit {index}</small></label>)}</div><div className="bitFlagValue"><span>{FUNCTION_FLAGS.filter((_, index) => (value & (1 << index)) !== 0).length} comportamentos ativos</span><code>{value} · 0x{value.toString(16).toUpperCase()}</code></div><small>{metadata.help}</small></fieldset>;
}

function relationText(metadata: SkillCreationField, value: SkillDraftValue | undefined, skills: SkillCatalogEntry[]) {
  if (metadata.id === "buffGroup" && typeof value === "number") {
    if (value === 255) return "Sem grupo: o GameServer permite empilhar este buff/debuff.";
    const related = skills.filter((skill) => skill.buffGroup === value).slice(0, 4);
    return `Mesmo grupo em ${skills.filter((skill) => skill.buffGroup === value).length} skills carregadas${related.length ? `: ${related.map((skill) => skill.name).join(", ")}` : ""}.`;
  }
  if (metadata.id === "skillGroup" && typeof value === "number") {
    if (value === 255) return "255 indica que esta base não usa um grupo explícito; preserve o valor e configure a cadeia por Skill raiz/Próxima grade.";
    const related = skills.filter((skill) => skill.skillGroup === value).slice(0, 4);
    return `Mesma família em ${skills.filter((skill) => skill.skillGroup === value).length} skills carregadas${related.length ? `: ${related.map((skill) => `${skill.name} G${skill.grade}`).join(", ")}` : ""}.`;
  }
  if (["rootSkillId", "nextSkillId"].includes(metadata.id) && typeof value === "number") return findSkillName(skills, value);
  if (metadata.id === "prerequisiteSkillIds" && Array.isArray(value)) return value.map((id) => findSkillName(skills, id)).join(" | ");
  // SP, LP, EP, RP e VP não ganham dica: ela só repetia o número que já está no campo.
  if (metadata.id === "requiredZenny" && typeof value === "number") return value === 0 ? "Aprendizado gratuito." : `${new Intl.NumberFormat("pt-BR").format(value)} Zeni para aprender.`;
  if (metadata.id === "useType" && typeof value === "number") return `Valor ${value} herdado por ${skills.filter((skill) => skill.useType === value).length} skills carregadas. Preserve se não houver regra específica.`;
  if (metadata.id === "restrictionRuleFlag" && typeof value === "number") return value === 0 ? "Nenhuma regra técnica adicional." : `Máscara ativa ${value} (0x${value.toString(16).toUpperCase()}); altere somente após mapear os bits.`;
  return "";
}
