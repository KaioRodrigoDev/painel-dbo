"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type {
  DropDraft, DropDraftValues, DropPublishPreview, DropRecordResponse, DropSlot, ItemCatalogResponse,
} from "@/lib/types";

const MAX_SLOTS = 20;
const TARGET_LABEL = { group: "grupo", bag: "bag" } as const;
const SLOT_LABEL = { group: "Bag", bag: "Item" } as const;
const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

/** Campos escalares do formulário, por tipo de registro. Espelha DROP_FIELDS do servidor. */
const SCALAR_FIELDS = {
  bag: [{ id: "level", label: "Nível da bag", min: 0, max: 255 }],
  group: [
    { id: "level", label: "Nível do grupo", min: 0, max: 255 },
    { id: "tryCount", label: "Tentativas por morte", min: 0, max: 255 },
    { id: "zenny", label: "Zeni do grupo", min: 0, max: 4294967295 },
    { id: "superior", label: "Superior (bruto)", min: 0, max: 10000 },
    { id: "excellent", label: "Excelente (bruto)", min: 0, max: 10000 },
    { id: "rare", label: "Raro (bruto)", min: 0, max: 10000 },
    { id: "legendary", label: "Lendário (bruto)", min: 0, max: 10000 },
  ],
} as const;

type SlotOption = { tblidx: number; name: string; iconName: string };

function SlotIcon({ iconName }: { iconName: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconName || failed) return <span className="dropItemIcon">—</span>;
  return <span className="dropItemIcon"><Image src={`/api/items/icons/${encodeURIComponent(iconName)}`} alt="" width={26} height={26} unoptimized onError={() => setFailed(true)} /></span>;
}

/**
 * Escolhe o que vai numa posição: um item (numa bag) ou uma bag (num grupo).
 *
 * Aceita o TBLIDX digitado direto, porque quem edita tabela costuma já ter o número na mão,
 * e uma busca por nome para quando não tem. O que vale é sempre o número no campo.
 */
function SlotPicker({ target, value, onPick }: { target: "group" | "bag"; value: number; onPick: (tblidx: number, label: SlotOption | null) => void }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<SlotOption[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setOptions([]); setOpen(false); return; }
      setSearching(true);
      try {
        const url = target === "bag"
          ? `/api/items?search=${encodeURIComponent(search.trim())}&page=1`
          : `/api/drop-records/bag?search=${encodeURIComponent(search.trim())}`;
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        setOptions(target === "bag"
          ? (body as ItemCatalogResponse).items.slice(0, 20).map((item) => ({ tblidx: item.tblidx, name: item.name, iconName: item.iconName }))
          : (body.records as { tblidx: number; name: string }[]).map((record) => ({ ...record, iconName: "" })));
        setOpen(true);
      } catch { /* busca abortada */ }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, target]);

  return <div className="dropSlotPicker">
    <input className="dropSlotId" type="number" min={1} value={value || ""} placeholder="TBLIDX"
      onChange={(event) => onPick(Number(event.target.value), null)} aria-label={`TBLIDX d${target === "bag" ? "o item" : "a bag"}`} />
    <div className="dropSlotSearch">
      <input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => options.length && setOpen(true)}
        placeholder={`Buscar ${target === "bag" ? "item" : "bag"} por nome`} maxLength={80} />
      {searching && <span className="dropSlotSearching">…</span>}
      {open && options.length > 0 && <ul className="dropSlotOptions">
        {options.map((option) => <li key={option.tblidx}>
          <button type="button" onClick={() => { onPick(option.tblidx, option); setOpen(false); setSearch(""); }}>
            {target === "bag" && <SlotIcon iconName={option.iconName} />}
            <span>{option.name}</span>
            <code>{option.tblidx}</code>
          </button>
        </li>)}
      </ul>}
    </div>
  </div>;
}

/**
 * A edição de um registro de drop, como página inteira.
 *
 * Nasceu dentro do modal de detalhes do mob e não coube: um registro tem até 20 posições, e
 * cada uma carrega ícone, nome, id, busca, chance e os botões de ordem. Com a revisão da
 * publicação aberta em cima disso, o modal virava uma coluna estreita de rolagem infinita.
 * Aqui segue o mesmo caminho do criador de skills -- troca a view da aba e volta pelo botão.
 */
export function DropEditorPage({ target, tblidx, originLabel, onBack }: {
  target: "group" | "bag"; tblidx: number; originLabel: string; onBack: () => void;
}) {
  const router = useRouter();
  const [record, setRecord] = useState<DropRecordResponse | null>(null);
  const [values, setValues] = useState<DropDraftValues | null>(null);
  const [labels, setLabels] = useState<Record<number, SlotOption>>({});
  const [openDraft, setOpenDraft] = useState<DropDraft | null>(null);
  const [preview, setPreview] = useState<DropPublishPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const [recordResponse, draftsResponse] = await Promise.all([
        fetch(`/api/drop-records/${target}/${tblidx}`, { signal, cache: "no-store" }),
        fetch("/api/drop-drafts", { signal, cache: "no-store" }),
      ]);
      if (recordResponse.status === 401) { router.push("/login"); return; }
      const body = await recordResponse.json().catch(() => ({}));
      if (!recordResponse.ok) throw new Error(body.error ?? "Falha ao carregar o registro.");
      const loaded = body as DropRecordResponse;
      setRecord(loaded);
      setValues(structuredClone(loaded.values));
      setLabels(Object.fromEntries(loaded.labels.map((label) => [label.tblidx, label])));
      const drafts = draftsResponse.ok ? ((await draftsResponse.json()).drafts as DropDraft[]) : [];
      setOpenDraft(drafts.find((draft) => draft.status === "draft" && draft.target === target && draft.tblidx === tblidx) ?? null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar o registro.");
    } finally { if (!signal.aborted) setLoading(false); }
  }, [router, target, tblidx]);

  useEffect(() => { const controller = new AbortController(); const request = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(request); controller.abort(); }; }, [load]);

  function updateSlot(index: number, patch: Partial<DropSlot>) {
    setValues((current) => {
      if (!current) return current;
      const slots = current.slots.map((slot, position) => position === index ? { ...slot, ...patch } : slot);
      return { ...current, slots };
    });
  }

  function addSlot() {
    setValues((current) => current && current.slots.length < MAX_SLOTS ? { ...current, slots: [...current.slots, { tblidx: 0, probability: 10 }] } : current);
  }

  function removeSlot(index: number) {
    setValues((current) => current ? { ...current, slots: current.slots.filter((_, position) => position !== index) } : current);
  }

  function moveSlot(index: number, direction: -1 | 1) {
    setValues((current) => {
      if (!current) return current;
      const next = [...current.slots];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, slots: next };
    });
  }

  async function saveDraft() {
    if (!values) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/drop-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, tblidx, values }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar o rascunho.");
      setOpenDraft(body.draft as DropDraft);
      setMessage("Rascunho salvo. Valide a publicação para revisar o que muda no RDF.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar o rascunho."); }
    finally { setBusy(false); }
  }

  async function discardDraft() {
    if (!openDraft) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/drop-drafts/${openDraft.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao descartar o rascunho.");
      setOpenDraft(null); setPreview(null); setAcknowledged(false);
      setMessage("Rascunho descartado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao descartar o rascunho."); }
    finally { setBusy(false); }
  }

  async function validatePublication() {
    if (!openDraft) return;
    setBusy(true); setError(""); setMessage(""); setAcknowledged(false);
    try {
      const response = await fetch(`/api/drop-drafts/${openDraft.id}/publish`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao validar a publicação.");
      setPreview(body.preview as DropPublishPreview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao validar a publicação."); }
    finally { setBusy(false); }
  }

  async function confirmPublication() {
    if (!openDraft || !preview?.confirmationToken || !acknowledged) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/drop-drafts/${openDraft.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationToken: preview.confirmationToken }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao publicar.");
      setMessage(`Publicado. Backup em ${body.result.backupPath}. Reinicie o GameServer para a mudança valer no jogo.`);
      setPreview(null); setOpenDraft(null); setAcknowledged(false);
      const controller = new AbortController();
      await load(controller.signal);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao publicar."); }
    finally { setBusy(false); }
  }

  const scalars = SCALAR_FIELDS[target];
  const totalProbability = values?.slots.reduce((total, slot) => total + (slot.probability || 0), 0) ?? 0;

  return <div className="dropEditorPage">
    <div className="draftCreatorHeader">
      <div>
        <div className="eyebrow">EDITAR {TARGET_LABEL[target].toUpperCase()} DE DROP</div>
        <h2>{record?.name ?? `#${tblidx}`}</h2>
        <p>#{tblidx} · {target === "bag" ? "table_item_bag_list_data.rdf" : "table_item_group_list_data.rdf"}</p>
      </div>
      <button className="catalogClearButton" type="button" onClick={onBack}>← Voltar para {originLabel}</button>
    </div>

    {loading && <div className="loadingState"><span className="spinner" /> Lendo o registro...</div>}
    {error && <div className="errorBanner"><strong>Falha</strong><span>{error}</span></div>}
    {message && <div className="successBanner"><strong>Feito</strong><span>{message}</span></div>}

    {record && values && <div className="dropEditorWorkspace">
      <div className="dropEditorMain">
        <div className="formGrid dropScalarGrid">
          {scalars.map((field) => <label key={field.id}>
            <span>{field.label}</span>
            <input type="number" min={field.min} max={field.max}
              value={String((values as Record<string, unknown>)[field.id] ?? 0)}
              onChange={(event) => setValues({ ...values, [field.id]: Number(event.target.value) })} />
          </label>)}
          {target === "bag" && <label className="dropCheckboxField">
            <input type="checkbox" checked={Boolean(values.enchantAble)} onChange={(event) => setValues({ ...values, enchantAble: event.target.checked })} />
            <span>Encantável</span>
          </label>}
        </div>

        <div className="dropSlotsHeader">
          <strong>{SLOT_LABEL[target]}s do registro</strong>
          <span>{values.slots.length} de {MAX_SLOTS} · soma das probabilidades {totalProbability}%</span>
          <button className="secondaryButton" type="button" onClick={addSlot} disabled={values.slots.length >= MAX_SLOTS}>+ Adicionar posição</button>
        </div>

        <ol className="dropSlotList">
          {values.slots.map((slot, index) => <li key={index}>
            <span className="dropSlotIndex">{index + 1}</span>
            {target === "bag" && <SlotIcon iconName={labels[slot.tblidx]?.iconName ?? ""} />}
            <div className="dropSlotBody">
              <span className="dropSlotName">{labels[slot.tblidx]?.name ?? (slot.tblidx ? `#${slot.tblidx}` : "Escolha um registro")}</span>
              <SlotPicker target={target} value={slot.tblidx} onPick={(picked, label) => {
                updateSlot(index, { tblidx: picked });
                if (label) setLabels((current) => ({ ...current, [picked]: label }));
              }} />
            </div>
            <label className="dropSlotProbability">
              <span>Chance</span>
              <input type="number" min={1} max={100} value={slot.probability} onChange={(event) => updateSlot(index, { probability: Number(event.target.value) })} />
            </label>
            <div className="dropSlotActions">
              <button type="button" onClick={() => moveSlot(index, -1)} disabled={index === 0} aria-label="Subir">↑</button>
              <button type="button" onClick={() => moveSlot(index, 1)} disabled={index === values.slots.length - 1} aria-label="Descer">↓</button>
              <button type="button" onClick={() => removeSlot(index)} aria-label="Remover">×</button>
            </div>
          </li>)}
        </ol>

        <div className="dropEditorActions">
          {openDraft
            ? <>
                <button className="secondaryButton" type="button" onClick={() => void discardDraft()} disabled={busy}>Descartar rascunho</button>
                <button className="primaryButton" type="button" onClick={() => void validatePublication()} disabled={busy}>Validar publicação</button>
              </>
            : <button className="primaryButton" type="button" onClick={() => void saveDraft()} disabled={busy}>Salvar rascunho</button>}
        </div>

        {openDraft && !preview && <p className="dropNote">Rascunho aberto por {openDraft.administrator} em {new Date(openDraft.createdAt).toLocaleString("pt-BR")} · {openDraft.changedFields.length} campo(s) alterado(s). Enquanto ele existir, o formulário acima não cria outro.</p>}
      </div>

      <aside className="dropEditorSide">
        <DropReach usage={record.usage} target={target} />
        <div className="itemDetailGrid">
          {record.readOnly.map((entry) => <div key={entry.label}><small>{entry.label}</small><strong>{entry.value}</strong></div>)}
        </div>
        <div className="readonlyNotice">
          <strong>Como o servidor lê isto</strong>
          <span>{target === "bag"
            ? "Cada item é sorteado pela chance dele, de 1 a 100. Num grupo de drop exclusivo de um mob o servidor ignora essas chances e sorteia 1 item com peso igual."
            : "Cada bag é aberta pela chance dela; dentro, cada item é sorteado pela sua. O grupo roda uma vez por tentativa."}</span>
          <span>As posições são gravadas compactadas e o contador sai do número de posições preenchidas, então não dá para criar o descompasso que existe hoje no grupo 333.</span>
        </div>
      </aside>
    </div>}

    {preview && <DropPublishReview preview={preview} acknowledged={acknowledged} onAcknowledge={setAcknowledged} onConfirm={() => void confirmPublication()} busy={busy} />}
  </div>;
}

function DropReach({ usage, target }: { usage: DropRecordResponse["usage"]; target: "group" | "bag" }) {
  const many = target === "bag" && usage.groups.length > 1;
  return <div className={many || usage.reachesWholeRegion ? "errorBanner subtle" : "dropOrigin"}>
    <strong>Alcance da edição</strong>
    <span>
      {usage.groups.length === 0 ? "Nenhum grupo usa este registro hoje." : `Usado por ${usage.groups.length} grupo(s): ${usage.groups.map((group) => `${group.name} (#${group.tblidx})`).join(", ")}.`}
      {usage.mobs.length > 0 && ` Mobs com drop exclusivo afetados: ${usage.mobs.map((mob) => `${mob.name} (nv ${mob.level})`).join(", ")}.`}
      {usage.reachesWholeRegion && " Algum grupo distribui drop por regra de mundo ou tipo de mob, então isso alcança muitos mobs além dos listados."}
    </span>
  </div>;
}

function DropPublishReview({ preview, acknowledged, onAcknowledge, onConfirm, busy }: {
  preview: DropPublishPreview; acknowledged: boolean; onAcknowledge: (value: boolean) => void; onConfirm: () => void; busy: boolean;
}) {
  const blocked = preview.blockingIssues.length > 0 || !preview.confirmationToken;
  return <section className="dropPublishReview">
    <h3>Revisão da publicação</h3>
    <p className="dropNote">Grava em <code>{preview.rdfPath}</code></p>

    {preview.blockingIssues.length > 0 && <div className="errorBanner">
      <strong>Publicação bloqueada</strong>
      {preview.blockingIssues.map((issue) => <span key={issue}>{issue}</span>)}
    </div>}

    {preview.changes.length > 0 && <table className="itemTable dropChangeTable">
      <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
      <tbody>{preview.changes.map((change) => <tr key={change.id}>
        <td>{change.label}</td>
        <td><small>{change.before}</small></td>
        <td><strong>{change.after}</strong></td>
      </tr>)}</tbody>
    </table>}

    <div className="readonlyNotice">
      <strong>Antes de confirmar</strong>
      {preview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
    </div>

    <label className="dropAcknowledge">
      <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} disabled={blocked} />
      <span>Li o que muda e quero gravar no RDF do servidor.</span>
    </label>
    <div className="dropEditorActions">
      <button className="primaryButton" type="button" onClick={onConfirm} disabled={blocked || !acknowledged || busy}>
        {busy ? "Publicando..." : "Publicar no RDF"}
      </button>
    </div>
  </section>;
}

export function DropDraftBadge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="dropDrawBadge">{formatNumber(count)} rascunho(s) de drop aberto(s)</span>;
}
