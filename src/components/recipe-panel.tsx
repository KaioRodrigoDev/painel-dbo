"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type {
  DropPublishChange, ItemCatalogResponse, RecipeDraft, RecipeItemCandidate, RecipeListResponse,
  RecipeMaterialValue, RecipePublishPreview, RecipeResultValue, RecipeValues,
} from "@/lib/types";

/** O que alimenta o editor: valores crus, com nome e ícone quando a lista já os resolveu. */
type EditorSeed = Omit<RecipeValues, "results" | "materials"> & {
  results: (RecipeResultValue & { name?: string; iconName?: string })[];
  materials: (RecipeMaterialValue & { name?: string; iconName?: string })[];
};

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

type ItemOption = { tblidx: number; name: string; iconName: string };

function ItemIcon({ iconName }: { iconName: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconName || failed) return <span className="dropItemIcon">—</span>;
  return <span className="dropItemIcon"><Image src={`/api/items/icons/${encodeURIComponent(iconName)}`} alt="" width={26} height={26} unoptimized onError={() => setFailed(true)} /></span>;
}

/** Busca um item comum pelo nome, para preencher material e resultado. */
function ItemPicker({ value, label, resolved, onPick }: {
  value: number; label: string; resolved: Map<number, ItemOption>; onPick: (tblidx: number, option: ItemOption | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ItemOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setOptions([]); setOpen(false); return; }
      try {
        const response = await fetch(`/api/items?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as ItemCatalogResponse;
        setOptions(body.items.slice(0, 20).map((item) => ({ tblidx: item.tblidx, name: item.name, iconName: item.iconName })));
        setOpen(true);
      } catch { /* busca abortada */ }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  const current = resolved.get(value);
  return <div className="skillRefPicker">
    <div className="skillRefCurrent">
      <ItemIcon iconName={current?.iconName ?? ""} />
      <div>
        <strong>{current?.name ?? (value ? `Item #${value}` : "Escolha um item")}</strong>
        <small>{value ? `#${value}` : "vazio"}</small>
      </div>
    </div>
    <div className="dropSlotSearch">
      <input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => options.length && setOpen(true)}
        placeholder={`Buscar item para ${label}`} maxLength={80} aria-label={label} />
      {open && options.length > 0 && <ul className="dropSlotOptions">
        {options.map((option) => <li key={option.tblidx}>
          <button type="button" onClick={() => { onPick(option.tblidx, option); setOpen(false); setSearch(""); }}>
            <ItemIcon iconName={option.iconName} />
            <span>{option.name}</span>
            <code>{option.tblidx}</code>
          </button>
        </li>)}
      </ul>}
    </div>
  </div>;
}

const EMPTY: EditorSeed = { valid: true, recipeType: 0, needMixLevel: 1, needMixZenny: 0, results: [], materials: [] };

/**
 * Criação e edição de receitas do HoiPoi Mix.
 *
 * A receita é encontrada pelo tblidx do ITEM que a ensina, então a tela começa escolhendo
 * esse item em vez de pedir um número: o tblidx e o nome saem dele. Um registro com tblidx
 * que não é item-receita vira uma receita que ninguém consegue aprender, como a 10150002
 * que já existe órfã na base.
 */
export function RecipePanel() {
  const router = useRouter();
  const [data, setData] = useState<RecipeListResponse | null>(null);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{ tblidx: number; name: string; nameTextId: number; values: EditorSeed; operation: "create" | "edit" } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (type) params.set("type", type);
    try {
      const response = await fetch(`/api/recipes?${params}`, { signal, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (response.status === 401) { router.push("/login"); return; } throw new Error(body.error ?? "Falha ao carregar receitas."); }
      setData(body as RecipeListResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar receitas.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [page, router, search, type]);

  useEffect(() => { const controller = new AbortController(); const request = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(request); controller.abort(); }; }, [load]);

  if (editor) return <RecipeEditor
    tblidx={editor.tblidx} name={editor.name} nameTextId={editor.nameTextId}
    initial={editor.values} operation={editor.operation}
    recipeTypes={data?.recipeTypes ?? []} maxMaterials={data?.maxMaterials ?? 5} maxResults={data?.maxResults ?? 3}
    onBack={() => { setEditor(null); void load(); }}
  />;

  return <div className="itemCatalogPanel">
    <form className="itemFilters" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(draftSearch.trim()); }}>
      <div className="searchInputWrap"><span aria-hidden="true">⌕</span>
        <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Buscar por nome da receita, TBLIDX ou item produzido" maxLength={80} /></div>
      <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} aria-label="Filtrar tipo">
        <option value="">Todos os tipos</option>
        {data?.recipeTypes.filter((entry) => entry.count > 0).map((entry) => <option key={entry.value} value={entry.value}>{entry.label} ({entry.count})</option>)}
      </select>
      <button className="primaryButton compact" type="submit">Buscar</button>
      {(search || type) && <button className="catalogClearButton" type="button" onClick={() => { setDraftSearch(""); setSearch(""); setType(""); setPage(1); }}>Limpar</button>}
    </form>

    <div className="listHeader">
      <div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> receitas encontradas</span></div>
      <div className="catalogSource">
        {data && <span>{data.sourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}
        <button className="refreshButton" onClick={() => void load()} disabled={loading}>↻ Atualizar</button>
        <button className="primaryButton compact" onClick={() => setEditor({ tblidx: 0, name: "", nameTextId: 0, values: EMPTY, operation: "create" })}>+ Criar receita</button>
      </div>
    </div>

    {error && <div className="errorBanner"><strong>Falha</strong><span>{error}</span></div>}
    {loading && <div className="loadingState"><span className="spinner" /> Lendo as receitas...</div>}
    {!loading && data?.recipes.length === 0 && <div className="emptyState">Nenhuma receita corresponde aos filtros.</div>}

    {!loading && data && data.recipes.length > 0 && <div className="itemTableWrap"><table className="itemTable">
      <thead><tr><th>TBLIDX</th><th>Receita</th><th>Produz</th><th>Materiais</th><th>Exige</th><th /></tr></thead>
      <tbody>{data.recipes.map((recipe) => <tr key={recipe.tblidx}>
        <td><code>{recipe.tblidx}</code></td>
        <td><div className="itemIdentity"><ItemIcon iconName={recipe.iconName} /><div>
          <strong>{recipe.name}</strong>
          <small>{data.recipeTypes.find((entry) => entry.value === recipe.recipeType)?.label ?? `Tipo ${recipe.recipeType}`}{recipe.valid ? "" : " · inativa"}</small>
        </div></div></td>
        <td><small>{recipe.results.map((slot) => `${slot.name} ${slot.rate}%`).join(" · ") || "—"}</small></td>
        <td><small>{recipe.materials.map((slot) => `${slot.name} ${slot.quantity}x`).join(" · ") || "—"}</small></td>
        <td><small>Mix {recipe.needMixLevel}<br />{formatNumber(recipe.needMixZenny)} zeni</small></td>
        <td><div className="catalogRowActions">
          {!recipe.hasRecipeItem && <span className="dropDrawBadge" title="Não existe item do tipo Receita com este TBLIDX">órfã</span>}
          <button className="catalogDetailsButton" onClick={() => setEditor({ tblidx: recipe.tblidx, name: recipe.name, nameTextId: recipe.nameTextId, values: recipe, operation: "edit" })}>Editar</button>
        </div></td>
      </tr>)}</tbody>
    </table></div>}

    {data && data.totalPages > 1 && <nav className="pagination" aria-label="Paginação das receitas">
      <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Anterior</button>
      <span>Página <strong>{data.page}</strong> de {data.totalPages}</span>
      <button disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Próxima →</button>
    </nav>}
  </div>;
}

function RecipeEditor({ tblidx, name, nameTextId, initial, operation, recipeTypes, maxMaterials, maxResults, onBack }: {
  tblidx: number; name: string; nameTextId: number; initial: EditorSeed; operation: "create" | "edit";
  recipeTypes: { value: number; label: string; count: number }[]; maxMaterials: number; maxResults: number; onBack: () => void;
}) {
  const [alvo, setAlvo] = useState({ tblidx, name, nameTextId });
  const [values, setValues] = useState<RecipeValues>({
    valid: initial.valid, recipeType: initial.recipeType, needMixLevel: initial.needMixLevel, needMixZenny: initial.needMixZenny,
    results: initial.results.map((slot) => ({ tblidx: slot.tblidx, rate: slot.rate, flag: slot.flag })),
    materials: initial.materials.map((slot) => ({ tblidx: slot.tblidx, quantity: slot.quantity })),
  });
  const [resolved, setResolved] = useState<Map<number, ItemOption>>(() => new Map([...initial.results, ...initial.materials].map((slot) =>
    [slot.tblidx, { tblidx: slot.tblidx, name: slot.name ?? `Item #${slot.tblidx}`, iconName: slot.iconName ?? "" }] as const)));
  const [openDraft, setOpenDraft] = useState<RecipeDraft | null>(null);
  const [preview, setPreview] = useState<RecipePublishPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const carregarRascunho = useCallback(async (alvoTblidx: number) => {
    if (!alvoTblidx) { setOpenDraft(null); return; }
    const response = await fetch("/api/recipe-drafts", { cache: "no-store" });
    if (!response.ok) return;
    const drafts = (await response.json()).drafts as RecipeDraft[];
    setOpenDraft(drafts.find((draft) => draft.status === "draft" && draft.tblidx === alvoTblidx) ?? null);
  }, []);
  useEffect(() => {
    const request = window.setTimeout(() => void carregarRascunho(alvo.tblidx), 0);
    return () => window.clearTimeout(request);
  }, [alvo.tblidx, carregarRascunho]);

  const setSlot = <K extends "results" | "materials">(campo: K, index: number, patch: Partial<RecipeValues[K][number]>) =>
    setValues((atual) => ({ ...atual, [campo]: atual[campo].map((slot, i) => i === index ? { ...slot, ...patch } : slot) }));
  const remover = (campo: "results" | "materials", index: number) =>
    setValues((atual) => ({ ...atual, [campo]: atual[campo].filter((_, i) => i !== index) }));

  async function salvar() {
    setBusy(true); setError(""); setMessage("");
    // As posições em branco são linhas que o administrador abriu e não preencheu. O registro
    // compacta tudo de qualquer jeito, então mandá-las só renderia "dados inválidos" do zod.
    const preenchidos = {
      ...values,
      results: values.results.filter((slot) => slot.tblidx > 0),
      materials: values.materials.filter((slot) => slot.tblidx > 0),
    };
    if (!preenchidos.materials.length || !preenchidos.results.length) {
      setError("Escolha pelo menos um material e um resultado antes de salvar.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/recipe-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tblidx: alvo.tblidx, values: preenchidos }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar o rascunho.");
      setOpenDraft(body.draft as RecipeDraft);
      setValues(preenchidos);
      setMessage("Rascunho salvo. Valide a publicação para revisar o que muda no RDF.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar o rascunho."); }
    finally { setBusy(false); }
  }

  async function descartar() {
    if (!openDraft) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/recipe-drafts/${openDraft.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao descartar.");
      setOpenDraft(null); setPreview(null); setAcknowledged(false); setMessage("Rascunho descartado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao descartar."); }
    finally { setBusy(false); }
  }

  async function validar() {
    if (!openDraft) return;
    setBusy(true); setError(""); setMessage(""); setAcknowledged(false);
    try {
      const response = await fetch(`/api/recipe-drafts/${openDraft.id}/publish`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao validar.");
      setPreview(body.preview as RecipePublishPreview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao validar."); }
    finally { setBusy(false); }
  }

  async function publicar() {
    if (!openDraft || !preview?.confirmationToken || !acknowledged) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/recipe-drafts/${openDraft.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationToken: preview.confirmationToken }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao publicar.");
      setMessage(`Publicado. Backup em ${body.result.backupPath}. Reinicie o GameServer para a mudança valer no jogo.`);
      setPreview(null); setOpenDraft(null); setAcknowledged(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao publicar."); }
    finally { setBusy(false); }
  }

  const somaChances = values.results.filter((slot) => slot.tblidx > 0).reduce((total, slot) => total + slot.rate, 0);

  return <div className="dropEditorPage">
    <div className="draftCreatorHeader">
      <div>
        <div className="eyebrow">{operation === "create" ? "CRIAR RECEITA" : "EDITAR RECEITA"}</div>
        <h2>{alvo.name || "Escolha o item-receita"}</h2>
        <p>{alvo.tblidx ? `#${alvo.tblidx} · Table_Item_Recipe_Data.rdf` : "A receita usa o TBLIDX do item que a ensina"}</p>
      </div>
      <button className="catalogClearButton" type="button" onClick={onBack}>← Voltar às receitas</button>
    </div>

    {error && <div className="errorBanner"><strong>Falha</strong><span>{error}</span></div>}
    {message && <div className="successBanner"><strong>Feito</strong><span>{message}</span></div>}

    <div className="dropEditorWorkspace">
      <div className="dropEditorMain">
        {operation === "create" && <RecipeItemPicker onPick={(item) => setAlvo({ tblidx: item.tblidx, name: item.name, nameTextId: item.nameTextId })} escolhido={alvo.tblidx} />}

        <div className="formGrid dropScalarGrid">
          <label><span>Tipo</span>
            <select value={values.recipeType} onChange={(event) => setValues({ ...values, recipeType: Number(event.target.value) })}>
              {recipeTypes.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select></label>
          <label><span>Nível de Mix exigido</span>
            <input type="number" min={0} max={255} value={values.needMixLevel} onChange={(event) => setValues({ ...values, needMixLevel: Number(event.target.value) })} /></label>
          <label><span>Custo em zeni</span>
            <input type="number" min={0} value={values.needMixZenny} onChange={(event) => setValues({ ...values, needMixZenny: Number(event.target.value) })} /></label>
          <label className="dropCheckboxField">
            <input type="checkbox" checked={values.valid} onChange={(event) => setValues({ ...values, valid: event.target.checked })} />
            <span>Receita ativa</span></label>
        </div>

        <div className="dropSlotsHeader">
          <strong>Materiais necessários</strong>
          <span>{values.materials.length} de {maxMaterials}</span>
          <button className="secondaryButton" type="button" disabled={values.materials.length >= maxMaterials}
            onClick={() => setValues({ ...values, materials: [...values.materials, { tblidx: 0, quantity: 1 }] })}>+ Adicionar material</button>
        </div>
        <ol className="dropSlotList recipeSlotList">
          {values.materials.map((slot, index) => <li key={index}>
            <span className="dropSlotIndex">{index + 1}</span>
            <div className="dropSlotBody">
              <ItemPicker value={slot.tblidx} label={`material ${index + 1}`} resolved={resolved}
                onPick={(picked, option) => { setSlot("materials", index, { tblidx: picked }); if (option) setResolved((atual) => new Map(atual).set(picked, option)); }} />
            </div>
            <label className="dropSlotProbability"><span>Quantidade</span>
              <input type="number" min={1} max={255} value={slot.quantity} onChange={(event) => setSlot("materials", index, { quantity: Number(event.target.value) })} /></label>
            <div className="dropSlotActions"><button type="button" onClick={() => remover("materials", index)} aria-label="Remover">×</button></div>
          </li>)}
        </ol>
        {values.materials.length === 0 && <div className="emptyState">Sem material nenhum a receita não funciona. Adicione pelo menos um.</div>}

        <div className="dropSlotsHeader">
          <strong>Resultados possíveis</strong>
          <span>{values.results.length} de {maxResults} · soma das chances {somaChances}%</span>
          <button className="secondaryButton" type="button" disabled={values.results.length >= maxResults}
            onClick={() => setValues({ ...values, results: [...values.results, { tblidx: 0, rate: 100, flag: 0 }] })}>+ Adicionar resultado</button>
        </div>
        <ol className="dropSlotList recipeSlotList">
          {values.results.map((slot, index) => <li key={index}>
            <span className="dropSlotIndex">{index + 1}</span>
            <div className="dropSlotBody">
              <ItemPicker value={slot.tblidx} label={`resultado ${index + 1}`} resolved={resolved}
                onPick={(picked, option) => { setSlot("results", index, { tblidx: picked }); if (option) setResolved((atual) => new Map(atual).set(picked, option)); }} />
            </div>
            <label className="dropSlotProbability"><span>Chance %</span>
              <input type="number" min={1} max={100} value={slot.rate} onChange={(event) => setSlot("results", index, { rate: Number(event.target.value) })} /></label>
            <div className="dropSlotActions"><button type="button" onClick={() => remover("results", index)} aria-label="Remover">×</button></div>
          </li>)}
        </ol>
        {values.results.length === 0 && <div className="emptyState">Adicione pelo menos um resultado.</div>}

        <div className="dropEditorActions">
          {openDraft
            ? <>
                <button className="secondaryButton" type="button" onClick={() => void descartar()} disabled={busy}>Descartar rascunho</button>
                <button className="primaryButton" type="button" onClick={() => void validar()} disabled={busy}>Validar publicação</button>
              </>
            : <button className="primaryButton" type="button" onClick={() => void salvar()} disabled={busy || !alvo.tblidx}>Salvar rascunho</button>}
        </div>
        {openDraft && !preview && <p className="dropNote">Rascunho aberto por {openDraft.administrator} em {new Date(openDraft.createdAt).toLocaleString("pt-BR")}.</p>}
      </div>

      <aside className="dropEditorSide">
        <div className="dropOrigin">
          <strong>Como o servidor usa isto</strong>
          <p className="dropNote">Ao fabricar, ele confere o nível de Mix, o zeni, e cada material <strong>na ordem e na quantidade</strong> definidas aqui.</p>
          <p className="dropNote">Os resultados são sorteados um a um pela chance. Se <strong>dois ou mais</strong> passarem, ele escolhe um deles ao acaso. Se nenhum ou só um passar, ele entrega sempre o <strong>resultado 1</strong> — então a primeira posição é a que mais sai.</p>
        </div>
        <div className="readonlyNotice">
          <strong>Receita e item são o mesmo número</strong>
          <span>O jogo procura a receita pelo TBLIDX do item que a ensina. Por isso a criação começa escolhendo esse item, em vez de pedir um número solto.</span>
          <span>Limites do jogo: {maxMaterials} materiais e {maxResults} resultados.</span>
        </div>
      </aside>
    </div>

    {preview && <RecipePublishReview preview={preview} acknowledged={acknowledged} onAcknowledge={setAcknowledged} onConfirm={() => void publicar()} busy={busy} />}
  </div>;
}

/** Escolhe o item-receita que vai dar nome e TBLIDX à receita nova. */
function RecipeItemPicker({ onPick, escolhido }: { onPick: (item: RecipeItemCandidate) => void; escolhido: number }) {
  const [search, setSearch] = useState("");
  const [onlyFree, setOnlyFree] = useState(true);
  const [items, setItems] = useState<RecipeItemCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/recipe-items?search=${encodeURIComponent(search.trim())}&onlyFree=${onlyFree ? "1" : "0"}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        setItems((await response.json()).items as RecipeItemCandidate[]);
      } catch { /* abortado */ }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, onlyFree]);

  return <fieldset className="draftField recipeItemPicker">
    <legend>1. Item que ensina a receita</legend>
    <p className="dropNote">O TBLIDX e o nome da receita saem deste item. Sem ele, ninguém consegue aprendê-la.</p>
    <div className="dropSlotsHeader">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar item-receita por nome ou TBLIDX" maxLength={80} />
      <label className="dropCheckboxField">
        <input type="checkbox" checked={onlyFree} onChange={(event) => setOnlyFree(event.target.checked)} />
        <span>Só os que ainda não têm receita</span></label>
    </div>
    {loading && <p className="dropNote">Buscando...</p>}
    <ul className="recipeCandidateList">
      {items.map((item) => <li key={item.tblidx} className={escolhido === item.tblidx ? "selected" : undefined}>
        <button type="button" onClick={() => onPick(item)} disabled={item.hasRecipe}>
          <ItemIcon iconName={item.iconName} />
          <span>{item.name}</span>
          <code>{item.tblidx}</code>
          {item.hasRecipe && <em>já tem receita</em>}
        </button>
      </li>)}
    </ul>
    {!loading && items.length === 0 && <p className="dropNote">Nenhum item-receita encontrado com esse filtro.</p>}
  </fieldset>;
}

function RecipePublishReview({ preview, acknowledged, onAcknowledge, onConfirm, busy }: {
  preview: RecipePublishPreview; acknowledged: boolean; onAcknowledge: (value: boolean) => void; onConfirm: () => void; busy: boolean;
}) {
  const blocked = preview.blockingIssues.length > 0 || !preview.confirmationToken;
  return <section className="dropPublishReview">
    <h3>Revisão da publicação {preview.operation === "create" ? "— registro novo" : "— edição"}</h3>
    <p className="dropNote">Grava em <code>{preview.rdfPath}</code></p>
    {preview.blockingIssues.length > 0 && <div className="errorBanner">
      <strong>Publicação bloqueada</strong>
      {preview.blockingIssues.map((issue) => <span key={issue}>{issue}</span>)}
    </div>}
    {preview.changes.length > 0 && <table className="itemTable dropChangeTable">
      <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
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
      <span>Li o que muda e quero gravar no Table_Item_Recipe_Data.rdf.</span>
    </label>
    <div className="dropEditorActions">
      <button className="primaryButton" type="button" onClick={onConfirm} disabled={blocked || !acknowledged || busy}>
        {busy ? "Publicando..." : "Publicar no RDF"}
      </button>
    </div>
  </section>;
}
