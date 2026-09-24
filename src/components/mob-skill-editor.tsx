"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type {
  DropPublishChange, MobCatalogEntry, MobSkillDraft, MobSkillPublishPreview, MobSkillsResponse, MobSkillValue, MobSkillValues, SkillCatalogResponse,
} from "@/lib/types";

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

type SkillOption = { tblidx: number; name: string; iconName: string; requiredEp: number };

function SkillIcon({ iconName }: { iconName: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconName || failed) return <span className="dropItemIcon">—</span>;
  return <span className="dropItemIcon"><Image src={`/api/skills/icons/${encodeURIComponent(iconName)}`} alt="" width={26} height={26} unoptimized onError={() => setFailed(true)} /></span>;
}

/** Busca de skill por nome, para não precisar decorar TBLIDX. */
function SkillPicker({ value, onPick }: { value: number; onPick: (tblidx: number, option: SkillOption | null) => void }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<SkillOption[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setOptions([]); setOpen(false); return; }
      setSearching(true);
      try {
        const response = await fetch(`/api/skills?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as SkillCatalogResponse;
        setOptions(body.skills.slice(0, 20).map((skill) => ({ tblidx: skill.tblidx, name: skill.name, iconName: skill.iconName, requiredEp: skill.requiredEp })));
        setOpen(true);
      } catch { /* busca abortada */ }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  return <div className="dropSlotPicker">
    <input className="dropSlotId" type="number" min={1} value={value || ""} placeholder="TBLIDX"
      onChange={(event) => onPick(Number(event.target.value), null)} aria-label="TBLIDX da skill" />
    <div className="dropSlotSearch">
      <input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => options.length && setOpen(true)}
        placeholder="Buscar skill por nome" maxLength={80} />
      {searching && <span className="dropSlotSearching">…</span>}
      {open && options.length > 0 && <ul className="dropSlotOptions">
        {options.map((option) => <li key={option.tblidx}>
          <button type="button" onClick={() => { onPick(option.tblidx, option); setOpen(false); setSearch(""); }}>
            <SkillIcon iconName={option.iconName} />
            <span>{option.name}</span>
            <code>{option.tblidx}</code>
          </button>
        </li>)}
      </ul>}
    </div>
  </div>;
}

/**
 * As skills que um mob usa, e a edição delas.
 *
 * Diferente dos drops, aqui ler e editar cabem na mesma tela: são no máximo sete posições.
 * Cada uma junta a skill, a condição que dispara (`byUse_Skill_Basis`) e os dois números que
 * a condição consome. O rótulo do campo de LP muda com a condição de propósito -- na condição
 * de distância o servidor lê o mesmo campo como alcance, e chamá-lo de "vida" ali seria
 * mentir sobre o que o número faz.
 */
export function MobSkillsPage({ mob, onBack }: { mob: MobCatalogEntry; onBack: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<MobSkillsResponse | null>(null);
  const [values, setValues] = useState<MobSkillValues | null>(null);
  const [labels, setLabels] = useState<Record<number, SkillOption>>({});
  const [openDraft, setOpenDraft] = useState<MobSkillDraft | null>(null);
  const [preview, setPreview] = useState<MobSkillPublishPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const [skillsResponse, draftsResponse] = await Promise.all([
        fetch(`/api/mobs/${mob.tblidx}/skills`, { signal, cache: "no-store" }),
        fetch("/api/mob-skill-drafts", { signal, cache: "no-store" }),
      ]);
      if (skillsResponse.status === 401) { router.push("/login"); return; }
      const body = await skillsResponse.json().catch(() => ({}));
      if (!skillsResponse.ok) throw new Error(body.error ?? "Falha ao carregar as skills.");
      const loaded = body as MobSkillsResponse;
      setData(loaded);
      setValues({ slots: loaded.slots.map((slot) => ({ tblidx: slot.tblidx, basis: slot.basis, lp: slot.lp, time: slot.time })) });
      setLabels(Object.fromEntries(loaded.slots.map((slot) => [slot.tblidx, { tblidx: slot.tblidx, name: slot.name, iconName: slot.iconName, requiredEp: slot.requiredEp }])));
      const drafts = draftsResponse.ok ? ((await draftsResponse.json()).drafts as MobSkillDraft[]) : [];
      setOpenDraft(drafts.find((draft) => draft.status === "draft" && draft.mobTblidx === mob.tblidx) ?? null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar as skills.");
    } finally { if (!signal.aborted) setLoading(false); }
  }, [mob.tblidx, router]);

  useEffect(() => { const controller = new AbortController(); const request = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(request); controller.abort(); }; }, [load]);

  const maxSlots = data?.maxSlots ?? 7;
  const lpMeaning = (basis: number) => data?.basisOptions.find((option) => option.value === basis)?.lpMeaning ?? "percent";

  function updateSlot(index: number, patch: Partial<MobSkillValue>) {
    setValues((current) => current ? { slots: current.slots.map((slot, position) => position === index ? { ...slot, ...patch } : slot) } : current);
  }
  function addSlot() {
    setValues((current) => current && current.slots.length < maxSlots ? { slots: [...current.slots, { tblidx: 0, basis: 5, lp: 100, time: 5000 }] } : current);
  }
  function removeSlot(index: number) {
    setValues((current) => current ? { slots: current.slots.filter((_, position) => position !== index) } : current);
  }
  function moveSlot(index: number, direction: -1 | 1) {
    setValues((current) => {
      if (!current) return current;
      const next = [...current.slots];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { slots: next };
    });
  }

  async function saveDraft() {
    if (!values) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/mob-skill-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobTblidx: mob.tblidx, values }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar o rascunho.");
      setOpenDraft(body.draft as MobSkillDraft);
      setMessage("Rascunho salvo. Valide a publicação para revisar o que muda no RDF.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar o rascunho."); }
    finally { setBusy(false); }
  }

  async function discardDraft() {
    if (!openDraft) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/mob-skill-drafts/${openDraft.id}`, { method: "DELETE" });
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
      const response = await fetch(`/api/mob-skill-drafts/${openDraft.id}/publish`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao validar a publicação.");
      setPreview(body.preview as MobSkillPublishPreview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao validar a publicação."); }
    finally { setBusy(false); }
  }

  async function confirmPublication() {
    if (!openDraft || !preview?.confirmationToken || !acknowledged) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/mob-skill-drafts/${openDraft.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationToken: preview.confirmationToken }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao publicar.");
      setMessage(`Publicado. Backup em ${body.result.backupPath}. Reinicie o GameServer para a mudança valer no jogo.`);
      setPreview(null); setOpenDraft(null); setAcknowledged(false);
      await load(new AbortController().signal);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao publicar."); }
    finally { setBusy(false); }
  }

  return <div className="dropEditorPage">
    <div className="draftCreatorHeader">
      <div>
        <div className="eyebrow">SKILLS DO MOB</div>
        <h2>{mob.name}</h2>
        <p>#{mob.tblidx} · nível {mob.level} · {data ? `${data.slots.length} de ${maxSlots} posições usadas` : "…"} · Table_MOB_Data.rdf</p>
      </div>
      <div className="dropPageHeaderActions">
        <button className="refreshButton" type="button" onClick={() => void load(new AbortController().signal)} disabled={loading}>↻ Atualizar</button>
        <button className="catalogClearButton" type="button" onClick={onBack}>← Voltar ao catálogo</button>
      </div>
    </div>

    {loading && <div className="loadingState"><span className="spinner" /> Lendo as skills do mob...</div>}
    {error && <div className="errorBanner"><strong>Falha</strong><span>{error}</span></div>}
    {message && <div className="successBanner"><strong>Feito</strong><span>{message}</span></div>}

    {data && values && <div className="dropEditorWorkspace">
      <div className="dropEditorMain">
        <div className="dropSlotsHeader">
          <strong>Skills deste mob</strong>
          <span>{values.slots.length} de {maxSlots}</span>
          <button className="secondaryButton" type="button" onClick={addSlot} disabled={values.slots.length >= maxSlots}>+ Adicionar skill</button>
        </div>

        {values.slots.length === 0 && <div className="emptyState">Este mob não usa nenhuma skill. Adicione uma posição para dar a primeira.</div>}

        <ol className="dropSlotList mobSkillList">
          {values.slots.map((slot, index) => {
            const meaning = lpMeaning(slot.basis);
            return <li key={index}>
              <span className="dropSlotIndex">{index + 1}</span>
              <SkillIcon iconName={labels[slot.tblidx]?.iconName ?? ""} />
              <div className="dropSlotBody">
                <span className="dropSlotName">
                  {labels[slot.tblidx]?.name ?? (slot.tblidx ? `#${slot.tblidx}` : "Escolha uma skill")}
                  {labels[slot.tblidx]?.requiredEp ? <small> · custa {formatNumber(labels[slot.tblidx].requiredEp)} EP</small> : null}
                </span>
                <SkillPicker value={slot.tblidx} onPick={(picked, option) => {
                  updateSlot(index, { tblidx: picked });
                  if (option) setLabels((current) => ({ ...current, [picked]: option }));
                }} />
              </div>
              <label className="mobSkillBasis">
                <span>Quando usa</span>
                <select value={slot.basis} onChange={(event) => updateSlot(index, { basis: Number(event.target.value) })}>
                  {data.basisOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="dropSlotProbability">
                <span>{meaning === "range" ? "Alcance" : meaning === "unused" ? "LP (ignorado)" : "LP %"}</span>
                <input type="number" min={0} max={meaning === "percent" ? 100 : 65535} value={slot.lp}
                  onChange={(event) => updateSlot(index, { lp: Number(event.target.value) })} />
              </label>
              <label className="dropSlotProbability">
                <span>Intervalo</span>
                <input type="number" min={0} max={65535} value={slot.time} onChange={(event) => updateSlot(index, { time: Number(event.target.value) })} />
              </label>
              <div className="dropSlotActions">
                <button type="button" onClick={() => moveSlot(index, -1)} disabled={index === 0} aria-label="Subir">↑</button>
                <button type="button" onClick={() => moveSlot(index, 1)} disabled={index === values.slots.length - 1} aria-label="Descer">↓</button>
                <button type="button" onClick={() => removeSlot(index)} aria-label="Remover">×</button>
              </div>
            </li>;
          })}
        </ol>

        <div className="dropEditorActions">
          {openDraft
            ? <>
                <button className="secondaryButton" type="button" onClick={() => void discardDraft()} disabled={busy}>Descartar rascunho</button>
                <button className="primaryButton" type="button" onClick={() => void validatePublication()} disabled={busy}>Validar publicação</button>
              </>
            : <button className="primaryButton" type="button" onClick={() => void saveDraft()} disabled={busy}>Salvar rascunho</button>}
        </div>

        {openDraft && !preview && <p className="dropNote">Rascunho aberto por {openDraft.administrator} em {new Date(openDraft.createdAt).toLocaleString("pt-BR")} · {openDraft.changedFields.length} posição(ões) alterada(s).</p>}
      </div>

      <aside className="dropEditorSide">
        <div className="dropOrigin">
          <strong>O que cada condição faz</strong>
          {data.basisOptions.map((option) => <p className="dropNote" key={option.value}><strong>{option.label}</strong> — {option.note}</p>)}
        </div>
        <div className="readonlyNotice">
          <strong>Como o servidor lê isto</strong>
          <span>São 7 posições fixas no registro do mob. O GameServer monta uma condição de uso por posição preenchida, em <code>CNpc::LoadSkillTable</code>.</span>
          <span>Uma condição fora da lista acima faz o servidor descartar a skill em silêncio, com erro só no log — por isso ela é um menu, não um campo livre.</span>
        </div>
      </aside>
    </div>}

    {preview && <MobSkillPublishReview preview={preview} acknowledged={acknowledged} onAcknowledge={setAcknowledged} onConfirm={() => void confirmPublication()} busy={busy} />}
  </div>;
}

function MobSkillPublishReview({ preview, acknowledged, onAcknowledge, onConfirm, busy }: {
  preview: MobSkillPublishPreview; acknowledged: boolean; onAcknowledge: (value: boolean) => void; onConfirm: () => void; busy: boolean;
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
      <thead><tr><th>Posição</th><th>Antes</th><th>Depois</th></tr></thead>
      <tbody>{preview.changes.map((change: DropPublishChange) => <tr key={change.id}>
        <td>{change.label}</td><td><small>{change.before}</small></td><td><strong>{change.after}</strong></td>
      </tr>)}</tbody>
    </table>}
    <div className="readonlyNotice">
      <strong>Antes de confirmar</strong>
      {preview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
    </div>
    <label className="dropAcknowledge">
      <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} disabled={blocked} />
      <span>Li o que muda e quero gravar no Table_MOB_Data.rdf.</span>
    </label>
    <div className="dropEditorActions">
      <button className="primaryButton" type="button" onClick={onConfirm} disabled={blocked || !acknowledged || busy}>
        {busy ? "Publicando..." : "Publicar no RDF"}
      </button>
    </div>
  </section>;
}
