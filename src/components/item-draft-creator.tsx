"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getFieldsForItemType,
  getItemCreationBaseValues,
  getItemCreationDefinition,
  ITEM_CREATION_PROFILES,
  ITEM_TYPE_CREATION_DEFINITIONS,
  type ItemCreationField,
} from "@/lib/item-creation-definitions";
import type { ItemCatalogEntry, ItemCatalogResponse, ItemDraft, ItemDraftsResponse, ItemDraftValue } from "@/lib/types";

const GROUP_LABELS: Record<ItemCreationField["group"], string> = {
  identity: "Identidade",
  inventory: "Inventário",
  economy: "Economia",
  visual: "Visual",
  equipment: "Equipamento",
  combat: "Combate",
  requirements: "Requisitos",
  options: "Opções e upgrade",
  behavior: "Comportamento",
  advanced: "Avançado",
};

const RANKS = ["Sem rank", "Normal", "Superior", "Excelente", "Raro", "Lendário"];

function sameValue(left: ItemDraftValue | undefined, right: ItemDraftValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function displayValue(value: ItemDraftValue | undefined) {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === "") return "—";
  return String(value);
}

export function ItemDraftCreator({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [itemType, setItemType] = useState(0);
  const [baseSearch, setBaseSearch] = useState("");
  const [bases, setBases] = useState<ItemCatalogEntry[]>([]);
  const [baseItem, setBaseItem] = useState<ItemCatalogEntry | null>(null);
  const [baseValues, setBaseValues] = useState<Record<string, ItemDraftValue>>({});
  const [values, setValues] = useState<Record<string, ItemDraftValue>>({});
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const definition = getItemCreationDefinition(itemType);
  const profile = definition ? ITEM_CREATION_PROFILES[definition.profile] : null;
  const fields = useMemo(() => getFieldsForItemType(itemType), [itemType]);
  const groupedFields = useMemo(() => Object.entries(GROUP_LABELS).map(([group, label]) => ({
    group: group as ItemCreationField["group"],
    label,
    fields: fields.filter((field) => field.group === group),
  })).filter((section) => section.fields.length), [fields]);
  const changedFields = useMemo(() => fields.filter((field) => !sameValue(values[field.id], baseValues[field.id])), [baseValues, fields, values]);

  const loadDrafts = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/item-drafts", { signal, cache: "no-store" });
    if (response.status === 401) {
      router.push("/login");
      return;
    }
    const body = (await response.json().catch(() => ({}))) as ItemDraftsResponse | { error?: string };
    if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao consultar rascunhos.");
    setDrafts((body as ItemDraftsResponse).drafts);
  }, [router]);

  const loadBases = useCallback(async (signal?: AbortSignal) => {
    setLoadingBases(true);
    try {
      const params = new URLSearchParams({ itemType: String(itemType), page: "1" });
      if (baseSearch.trim()) params.set("search", baseSearch.trim());
      const response = await fetch(`/api/items?${params}`, { signal, cache: "no-store" });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as ItemCatalogResponse | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao consultar itens-base.");
      setBases((body as ItemCatalogResponse).items);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao consultar itens-base.");
    } finally {
      if (!signal?.aborted) setLoadingBases(false);
    }
  }, [baseSearch, itemType, router]);

  useEffect(() => {
    const controller = new AbortController();
    const request = window.setTimeout(() => void loadDrafts(controller.signal).catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao consultar rascunhos.")), 0);
    return () => { window.clearTimeout(request); controller.abort(); };
  }, [loadDrafts]);

  useEffect(() => {
    const controller = new AbortController();
    const request = window.setTimeout(() => void loadBases(controller.signal), 250);
    return () => { window.clearTimeout(request); controller.abort(); };
  }, [loadBases]);

  function changeType(rawValue: string) {
    setItemType(Number(rawValue));
    setBaseItem(null);
    setBaseValues({});
    setValues({});
    setBaseSearch("");
    setError("");
    setMessage("");
  }

  function selectBase(rawValue: string) {
    const selected = bases.find((item) => item.tblidx === Number(rawValue)) ?? null;
    setBaseItem(selected);
    setError("");
    setMessage("");
    if (!selected) {
      setBaseValues({});
      setValues({});
      return;
    }
    const completeBase = getItemCreationBaseValues(selected);
    const applicable = Object.fromEntries(fields.map((field) => [field.id, completeBase[field.id]])) as Record<string, ItemDraftValue>;
    setBaseValues(applicable);
    setValues({
      ...applicable,
      tblidx: 0,
      name: `${selected.name} - Novo`,
      ...(definition?.defaultEquipType !== undefined ? { equipType: definition.defaultEquipType } : {}),
      ...(definition?.defaultSlotFlag !== undefined ? { equipSlotFlag: definition.defaultSlotFlag } : {}),
    });
  }

  function changeField(metadata: ItemCreationField, rawValue: string | boolean) {
    let value: ItemDraftValue;
    if (metadata.control === "checkbox") value = Boolean(rawValue);
    else if (["scouterParts", "creationRanks", "revisions", "disassemble"].includes(metadata.id)) {
      value = String(rawValue).split(",").map((part) => Number(part.trim())).filter(Number.isFinite);
    } else if (["number", "select", "bitflag", "reference"].includes(metadata.control)) {
      value = rawValue === "" ? 0 : Number(rawValue);
    } else value = String(rawValue);
    setValues((current) => ({ ...current, [metadata.id]: value }));
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!baseItem) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/item-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType,
          baseTblidx: baseItem.tblidx,
          newTblidx: Number(values.tblidx),
          name: String(values.name ?? ""),
          values,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { draft?: ItemDraft; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o rascunho.");
      setMessage(`Rascunho ${body.draft?.newTblidx} salvo. Nenhum arquivo do jogo foi alterado.`);
      await loadDrafts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o rascunho.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="itemDraftCreator">
    <div className="draftCreatorHeader">
      <div><div className="eyebrow">FASE 2 · RASCUNHO SEGURO</div><h2>Criar item</h2><p>Escolha uma categoria e clone a estrutura de um item compatível.</p></div>
      <button className="catalogClearButton" type="button" onClick={onBack}>← Voltar ao catálogo</button>
    </div>

    <div className="draftSafetyBanner"><strong>Nenhuma publicação automática</strong><span>Salvar cria somente um JSON. RDF, PAK, cliente e servidor permanecem intactos.</span></div>

    <section className="draftSetupGrid">
      <label><span>1. Categoria</span><select value={itemType} onChange={(event) => changeType(event.target.value)}>
        {ITEM_TYPE_CREATION_DEFINITIONS.map((item) => <option key={item.value} value={item.value} disabled={!item.observed}>{item.label} ({item.value}){item.custom ? " · customizado" : ""}{!item.observed ? " · sem base" : ""}</option>)}
      </select></label>
      <label><span>Buscar item-base</span><input value={baseSearch} onChange={(event) => setBaseSearch(event.target.value)} placeholder="Nome ou TBLIDX" maxLength={80} /></label>
      <label><span>2. Item-base</span><select value={baseItem?.tblidx ?? ""} onChange={(event) => selectBase(event.target.value)} disabled={loadingBases}>
        <option value="">{loadingBases ? "Consultando..." : "Selecione um item"}</option>
        {bases.map((item) => <option key={item.tblidx} value={item.tblidx}>#{item.tblidx} · {item.name}</option>)}
      </select></label>
    </section>

    {profile && <div className="profileSummary"><div><strong>{profile.label}</strong><span>{profile.notes}</span></div><span>{fields.length} campos aplicáveis</span></div>}
    {error && <div className="errorBanner"><strong>Não foi possível continuar</strong><span>{error}</span></div>}
    {message && <div className="successBanner"><strong>Rascunho registrado</strong><span>{message}</span></div>}

    {!baseItem ? <div className="draftEmptyState">Selecione um item-base para abrir os campos da categoria.</div> : <form onSubmit={saveDraft}>
      <div className="draftWorkspace">
        <div className="draftFields">
          {groupedFields.map((section, index) => <details className="draftFieldGroup" open={index < 6} key={section.group}>
            <summary><strong>{section.label}</strong><span>{section.fields.length} campos</span></summary>
            <div className="draftFieldGrid">{section.fields.map((metadata) => <DraftField key={metadata.id} metadata={metadata} value={values[metadata.id]} changed={!sameValue(values[metadata.id], baseValues[metadata.id])} onChange={(value) => changeField(metadata, value)} />)}</div>
          </details>)}
        </div>
        <aside className="draftDiffPanel">
          <div><div className="eyebrow">PRÉ-VISUALIZAÇÃO</div><h3>{String(values.name || "Novo item")}</h3><p>Novo #{displayValue(values.tblidx)} baseado em #{baseItem.tblidx}</p></div>
          <strong>{changedFields.length} alterações</strong>
          <div className="draftDiffList">{changedFields.map((metadata) => <div key={metadata.id}><span>{metadata.label}</span><small>{displayValue(baseValues[metadata.id])} →</small><strong>{displayValue(values[metadata.id])}</strong></div>)}</div>
          {!changedFields.length && <p className="muted">Nenhum campo foi alterado.</p>}
          <button className="primaryButton" disabled={saving || Number(values.tblidx) < 1 || !String(values.name ?? "").trim()}>{saving ? "Salvando..." : "Salvar rascunho JSON"}</button>
        </aside>
      </div>
    </form>}

    <section className="savedDrafts"><div className="serverSectionHeader"><div><strong>Rascunhos salvos</strong><span>Ainda não publicados no jogo</span></div><span>{drafts.length}</span></div>
      {drafts.length === 0 ? <p className="muted">Nenhum rascunho criado.</p> : <div className="savedDraftGrid">{drafts.map((draft) => <article key={draft.id}><div><strong>{draft.name}</strong><span>#{draft.newTblidx} · {draft.profile}</span></div><small>Base #{draft.baseTblidx} · {draft.changedFields.length} alterações · {new Date(draft.updatedAt).toLocaleString("pt-BR")}</small></article>)}</div>}
    </section>
  </div>;
}

function DraftField({ metadata, value, changed, onChange }: { metadata: ItemCreationField; value: ItemDraftValue | undefined; changed: boolean; onChange: (value: string | boolean) => void }) {
  const className = changed ? "draftField changed" : "draftField";
  if (metadata.control === "checkbox") return <label className={`${className} checkboxField`}><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span><strong>{metadata.label}</strong><small>{metadata.sourceField}</small></span></label>;
  if (metadata.id === "rank") return <label className={className}><span>{metadata.label}{metadata.required ? " *" : ""}</span><select value={Number(value ?? 0)} onChange={(event) => onChange(event.target.value)}>{RANKS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select><small>{metadata.sourceField}</small></label>;
  if (metadata.id === "bagSize") return <label className={className}><span>{metadata.label}</span><select value={Number(value ?? 0)} onChange={(event) => onChange(event.target.value)}><option value={0}>Não aplicável</option>{[4,8,12,16,20,24,28,32].map((size) => <option key={size} value={size}>{size} espaços</option>)}</select><small>{metadata.help}</small></label>;
  const composite = ["scouterParts", "creationRanks", "revisions", "disassemble"].includes(metadata.id);
  const inputType = metadata.control === "text" ? "text" : "number";
  return <label className={className}><span>{metadata.label}{metadata.required ? " *" : ""}</span>{metadata.id === "description"
    ? <textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} maxLength={2000} />
    : <input type={composite ? "text" : inputType} value={displayValue(value) === "—" ? "" : displayValue(value)} min={metadata.min} max={metadata.max} step={["attackRangeBonus", "revisions"].includes(metadata.id) ? "any" : undefined} onChange={(event) => onChange(event.target.value)} required={metadata.required} />}
    <small>{composite ? "Valores separados por vírgula · " : ""}{metadata.sourceField}{metadata.help ? ` · ${metadata.help}` : ""}</small></label>;
}
