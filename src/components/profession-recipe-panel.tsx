"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ItemIcon, type ItemOption, ItemPicker, RecipeFormula } from "@/components/recipe-panel";
import {
  allowedBatches, catalogDraftIssues, formatDuration, PROFESSION_BASE_NAMES, PROFESSION_BENCH_NAMES, PROFESSION_LIMITS,
  PROFESSION_SPECIALIZATION_NAMES, professionRecipeIssues,
} from "@/lib/profession-rules";
import type {
  ProfessionCatalogDraft, ProfessionCatalogInfo, ProfessionRecipe, ProfessionRecipeIdentity, ProfessionRecipeItem, ProfessionRecipeOverview,
  ProfessionRecipeValues,
} from "@/lib/types";

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "não encontrado");
const RELOAD_HINT = "Gravado no banco. Para valer no jogo, digite forgerecipesreload no console do QueryServer (ou reinicie o QueryServer) e reabra a oficina.";

const valuesOf = (recipe: ProfessionRecipe): ProfessionRecipeValues => ({
  requiredLevel: recipe.requiredLevel, durationSeconds: recipe.durationSeconds, experience: recipe.experience,
  outputCount: recipe.outputCount, amounts: recipe.inputs.map((input) => input.amount), enabled: recipe.enabled,
});

/** Profissão, produto e materiais que o jogo vai usar: os do catálogo quando há troca pendente. */
const identityOf = (recipe: ProfessionRecipe): ProfessionRecipeIdentity => recipe.pending ?? {
  specialization: recipe.specialization, output: recipe.output, outputCount: recipe.outputCount,
  outputDurability: recipe.outputDurability, inputs: recipe.inputs,
};

function professionLabel(base: number, specialization: number) {
  const name = PROFESSION_SPECIALIZATION_NAMES[specialization];
  return `${PROFESSION_BASE_NAMES[base] ?? `Profissão ${base}`}${name ? ` · ${name}` : ""}`;
}

function BatchBadges({ batches }: { batches: number[] }) {
  return <span className="profBatches" title="Lotes que a bancada deixa iniciar (tempo, materiais e XP multiplicam)">
    {PROFESSION_LIMITS.batches.map((quantity) => <b key={quantity} className={batches.includes(quantity) ? "on" : ""}>{quantity}x</b>)}
  </span>;
}

/** Receitas das oficinas de profissão (mdbo_char.profession_forge_recipe + catálogo compilado). */
export function ProfessionRecipePanel() {
  const router = useRouter();
  const [overview, setOverview] = useState<ProfessionRecipeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [bench, setBench] = useState("");
  const [editing, setEditing] = useState<ProfessionRecipe | "new" | null>(null);

  const request = useCallback(async <T,>(body?: unknown): Promise<T> => {
    const response = await fetch("/api/profession-recipes", body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401) { router.push("/login"); throw new Error("Sessão expirada."); }
    const parsed = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(parsed.error ?? "A operação falhou.");
    return parsed;
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOverview((await request<{ overview: ProfessionRecipeOverview }>()).overview); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar as receitas."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  // Enquanto falta build, confere sozinho de tempos em tempos (só com a aba visível e sem editor aberto).
  const waitingBuild = !!overview?.catalog.buildNeeded && overview.catalog.pendingIds.length > 0;
  useEffect(() => {
    if (!waitingBuild || editing) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [waitingBuild, editing, load]);

  const recipes = useMemo(() => {
    const text = search.trim().toLowerCase();
    return (overview?.recipes ?? []).filter((recipe) => {
      const identity = identityOf(recipe);
      return (!bench || String(recipe.base) === bench) &&
        (!text || String(recipe.id) === text || identity.output.name.toLowerCase().includes(text) ||
          identity.inputs.some((input) => input.name.toLowerCase().includes(text)));
    });
  }, [overview, search, bench]);
  const active = overview?.recipes.filter((recipe) => recipe.enabled).length ?? 0;
  const broken = overview?.recipes.filter((recipe) => recipe.enabled && recipe.issues.length) ?? [];
  const catalog = overview?.catalog;

  async function apply() {
    if (!catalog) return;
    setApplying(true); setNotice(""); setError("");
    try {
      const body = await request<{ overview: ProfessionRecipeOverview; applied: { inserted: number[]; updated: number[]; brokenOrders: string[] } }>({ action: "apply", version: catalog.version });
      setOverview(body.overview);
      const { inserted, updated, brokenOrders } = body.applied;
      setNotice([
        inserted.length ? `Novas no banco: ${inserted.map((id) => `#${id}`).join(", ")}.` : "",
        updated.length ? `Atualizadas: ${updated.map((id) => `#${id}`).join(", ")}.` : "",
        "Agora inicie os servidores (ou digite forgerecipesreload no console do QueryServer) e reabra a oficina.",
        brokenOrders.length ? `Atenção: ordens antigas que o build novo não lê: ${brokenOrders.join(", ")}.` : "",
      ].filter(Boolean).join(" "));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível aplicar."); }
    finally { setApplying(false); }
  }

  return <div className="itemCatalogPanel">
    <form className="itemFilters" onSubmit={(event: FormEvent) => event.preventDefault()}>
      <div className="searchInputWrap"><span aria-hidden="true">⌕</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por ID, item produzido ou material" maxLength={80} /></div>
      <select value={bench} onChange={(event) => setBench(event.target.value)} aria-label="Filtrar oficina">
        <option value="">Todas as oficinas</option>
        {Object.entries(PROFESSION_BENCH_NAMES).map(([base, name]) => <option key={base} value={base}>{name}</option>)}
      </select>
      {(search || bench) && <button className="catalogClearButton" type="button" onClick={() => { setSearch(""); setBench(""); }}>Limpar</button>}
      <button className="secondaryButton" type="button" disabled={!catalog?.available || !overview?.itemsLoaded} onClick={() => { setNotice(""); setEditing("new"); }}
        title={catalog?.available ? "Receita nova da Oficina do Ferreiro (vale depois do build)" : catalog?.reason}>+ Nova receita</button>
    </form>

    <div className="listHeader">
      <div><strong>{overview ? formatNumber(overview.recipes.length) : "—"}</strong><span> receitas · {formatNumber(active)} ativas</span></div>
      <div className="catalogSource">
        <span>mdbo_char.profession_forge_recipe · vale após forgerecipesreload no QueryServer</span>
        <button className="refreshButton" onClick={() => void load()} disabled={loading}>↻ Atualizar</button>
      </div>
    </div>

    {catalog && <CatalogStatus catalog={catalog} applying={applying} onApply={() => void apply()} />}
    {error && <div className="errorBanner"><strong>Não foi possível concluir</strong><span>{error}</span></div>}
    {notice && <div className="successBanner"><strong>Pronto</strong><span>{notice}</span></div>}
    {overview && !overview.ready && <div className="errorBanner"><strong>A tabela de receitas não existe neste banco</strong>
      <span>Faça backup do mdbo_char e aplique DboServer/Database/migrations/20261028_miner_recipes.sql (cria e ativa as receitas do Minerador).</span></div>}
    {overview?.ready && !overview.itemsLoaded && <div className="errorBanner subtle"><strong>Table_Item_Data não lida</strong>
      <span>Nomes, ícones e o cálculo de lotes dependem da tabela de itens; a gravação continua conferindo as regras do servidor.</span></div>}
    {broken.length > 0 && <div className="errorBanner"><strong>{broken.length} receita(s) ativa(s) que o servidor recusa</strong>
      <span>Com uma delas ativa, o forgerecipesreload falha e o QueryServer continua com o catálogo antigo (ou sem oficina, se for na inicialização): {broken.map((recipe) => `#${recipe.id}`).join(", ")}. Corrija ou desative.</span></div>}
    {loading && !overview && <div className="loadingState"><span className="spinner" /> Lendo as receitas...</div>}
    {overview?.ready && !recipes.length && <div className="emptyState">Nenhuma receita corresponde aos filtros.</div>}

    {recipes.length > 0 && <div className="itemTableWrap"><table className="itemTable">
      <thead><tr><th>ID</th><th>Materiais → Produz</th><th>Profissão</th><th>Nível</th><th>Tempo</th><th>XP</th><th>Lotes</th><th /></tr></thead>
      <tbody>{recipes.map((recipe) => {
        const identity = identityOf(recipe);
        return <tr key={recipe.id} className={recipe.enabled || recipe.pending ? "" : "profDisabledRow"}>
          <td><code>{recipe.id}</code></td>
          <td><RecipeFormula
            materials={identity.inputs.map((input) => ({ tblidx: input.tblidx, name: input.name, iconName: input.iconName, missing: input.maxStack === null, badge: `${input.amount}x` }))}
            results={[{ tblidx: identity.output.tblidx, name: identity.output.name, iconName: identity.output.iconName, missing: identity.output.maxStack === null, badge: `${identity.outputCount}x` }]}
          /></td>
          <td><small>{professionLabel(recipe.base, identity.specialization)}<br />{PROFESSION_BENCH_NAMES[recipe.base] ?? "—"}</small></td>
          <td>{recipe.requiredLevel}</td>
          <td>{formatDuration(recipe.durationSeconds)}</td>
          <td>{formatNumber(recipe.experience)}</td>
          <td><BatchBadges batches={recipe.batches} /></td>
          <td><div className="catalogRowActions">
            {recipe.pending && <span className="dropDrawBadge profPending" title={recipe.inDatabase
              ? `No jogo hoje: ${recipe.inputs.map((input) => `${input.amount}x ${input.name}`).join(" + ")} → ${recipe.output.name} (${professionLabel(recipe.base, recipe.specialization)})`
              : "Receita nova: entra no banco ao aplicar depois do build"}>
              {catalog?.buildNeeded ? "aguardando build" : "aplicar no banco"}</span>}
            {!recipe.enabled && recipe.inDatabase && <span className="dropDrawBadge">desativada</span>}
            {recipe.issues.length > 0 && <span className="dropDrawBadge profIssue" title={recipe.issues.join("\n")}>{recipe.enabled ? "recusada" : "inválida"}</span>}
            <button className="catalogDetailsButton" onClick={() => { setNotice(""); setEditing(recipe); }}>Editar</button>
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>}

    {editing && catalog && <RecipeEditorModal recipe={editing === "new" ? null : editing} catalog={catalog} onClose={() => setEditing(null)}
      onSubmitValues={async (recipe, values) => {
        const body = await request<{ overview: ProfessionRecipeOverview }>({ action: "update", id: recipe.id, values, expected: valuesOf(recipe) });
        setOverview(body.overview); setEditing(null); setNotice(`Receita #${recipe.id} gravada. ${RELOAD_HINT}`);
      }}
      onSubmitCatalog={async (draft) => {
        const body = await request<{ overview: ProfessionRecipeOverview; id: number }>({ action: "catalog", draft, version: catalog.version });
        setOverview(body.overview); setEditing(null);
        setNotice(body.overview.catalog.buildNeeded
          ? `Receita #${body.id} salva no catálogo. Falta o build (veja o aviso acima); depois volte aqui e aplique no banco.`
          : `Receita #${body.id} salva no catálogo. O código compilado não mudou: aplique no banco.`);
      }} />}
  </div>;
}

/** Se o catálogo compilado está em dia com os executáveis e com o banco. */
function CatalogStatus({ catalog, applying, onApply }: { catalog: ProfessionCatalogInfo; applying: boolean; onApply: () => void }) {
  if (!catalog.available) return <div className="errorBanner subtle"><strong>Catálogo do MDBO não encontrado</strong>
    <span>{catalog.reason} Sem ele dá para mudar só nível, tempo, XP, quantidades e se a receita está ativa.</span></div>;
  const pending = catalog.pendingIds.map((id) => `#${id}`).join(", ");
  if (catalog.buildNeeded) return <div className="warningBanner profBuildBanner">
    <strong>Precisa de build</strong>
    <span>O catálogo de receitas (NtlMinerRecipes.h, alterado em {formatDate(catalog.sourceChangedAt)}) é mais novo que o que está compilado.
      Pare os servidores e feche o jogo, rode no PowerShell:</span>
    <ul>{catalog.build.filter((part) => part.stale).map((part) => <li key={part.label}>
      <code>{part.command}</code> — {part.label} (compilado em {formatDate(part.builtAt)})</li>)}</ul>
    <span>{pending ? `Depois do build volte aqui e aplique no banco (${pending}). ` : ""}O painel confere sozinho a cada 20 s ou em ↻ Atualizar.</span>
  </div>;
  if (catalog.applyReady) return <div className="warningBanner profBuildBanner">
    <strong>Build em dia — falta aplicar no banco</strong>
    <span>Receitas com profissão, produto ou materiais novos: {pending}. Aplique com os servidores parados (ou depois digite forgerecipesreload no QueryServer).</span>
    <div><button className="primaryButton compact" disabled={applying} onClick={onApply}>{applying ? "Aplicando..." : "Aplicar no banco"}</button></div>
  </div>;
  return null;
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="bpField"><span className="bpFieldLabel">{label}{hint && <em>{hint}</em>}</span>{children}</label>;
}

type Slot = ProfessionRecipeItem & { amount: number };
const asItem = (option: ItemOption): ProfessionRecipeItem => ({ tblidx: option.tblidx, name: option.name, iconName: option.iconName, maxStack: option.maxStack ?? null });
const EMPTY_ITEM: ProfessionRecipeItem = { tblidx: 0, name: "", iconName: "", maxStack: null };

function RecipeEditorModal({ recipe, catalog, onClose, onSubmitValues, onSubmitCatalog }: {
  recipe: ProfessionRecipe | null; catalog: ProfessionCatalogInfo; onClose: () => void;
  onSubmitValues: (recipe: ProfessionRecipe, values: ProfessionRecipeValues) => Promise<void>;
  onSubmitCatalog: (draft: ProfessionCatalogDraft) => Promise<void>;
}) {
  const base = recipe ? identityOf(recipe) : null;
  const [values, setValues] = useState<ProfessionRecipeValues>(() => recipe ? valuesOf(recipe)
    : { requiredLevel: 1, durationSeconds: 30, experience: 5, outputCount: 1, amounts: [], enabled: true });
  const [specialization, setSpecialization] = useState(base?.specialization ?? 0);
  const [output, setOutput] = useState<ProfessionRecipeItem>(base?.output ?? EMPTY_ITEM);
  const [outputCount, setOutputCount] = useState(base?.outputCount ?? 1);
  const [inputs, setInputs] = useState<Slot[]>(base?.inputs ?? [{ ...EMPTY_ITEM, amount: 1 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ProfessionRecipeValues>(key: K, value: ProfessionRecipeValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

  const isNew = recipe === null;
  const editable = isNew || recipe.identityEditable;
  // Sem linha no banco (nova ou só no catálogo), nível, tempo e XP também vão para o catálogo.
  const balanceInCatalog = isNew || !recipe.inDatabase;
  const kindOf = (tblidx: number) => catalog.items.find((item) => item.tblidx === tblidx);
  const tool = kindOf(output.tblidx)?.kind === "tool" ? kindOf(output.tblidx) : undefined;
  const effectiveCount = tool ? 1 : outputCount;
  const effectiveLevel = balanceInCatalog && tool?.requiredLevel ? tool.requiredLevel : values.requiredLevel;

  const itemsChanged = !base || specialization !== base.specialization || output.tblidx !== base.output.tblidx ||
    inputs.length !== base.inputs.length || inputs.some((input, index) => input.tblidx !== base.inputs[index]!.tblidx);
  const countsChanged = !base || effectiveCount !== base.outputCount || inputs.some((input, index) => input.amount !== base.inputs[index]?.amount);
  // Vai para o catálogo (e pede build): receita nova, troca de item/profissão, ou receita com troca
  // pendente (o banco ainda tem os materiais antigos, então as quantidades novas ficam no catálogo).
  const catalogMode = editable && (isNew || itemsChanged || (!!recipe.pending && countsChanged) || !recipe.inDatabase);

  const draft: ProfessionCatalogDraft = {
    id: recipe?.id ?? null, specialization, outputItem: output.tblidx, outputCount: effectiveCount,
    inputs: inputs.map((input) => ({ item: input.tblidx, count: input.amount })),
    requiredLevel: effectiveLevel, durationSeconds: values.durationSeconds, experience: values.experience,
  };
  const shape = {
    id: recipe?.id ?? 0, base: recipe?.base ?? 1, specialization,
    requiredLevel: effectiveLevel, durationSeconds: values.durationSeconds, experience: values.experience,
    outputItem: output.tblidx, outputCount: effectiveCount, outputDurability: tool ? 1 : itemsChanged ? 0 : base?.outputDurability ?? 0,
    inputItems: inputs.map((input) => input.tblidx), amounts: inputs.map((input) => input.amount),
  };
  const issues = catalogMode ? catalogDraftIssues(draft, catalog, { balance: balanceInCatalog }) : professionRecipeIssues(shape, undefined);
  const itemsKnown = output.maxStack !== null && inputs.every((input) => input.maxStack !== null);
  const batches = allowedBatches(shape, output.maxStack, inputs.map((input) => input.maxStack));
  const blocked = catalogMode ? issues.length > 0 || (itemsKnown && !batches.includes(1))
    : values.enabled && (issues.length > 0 || (itemsKnown && !batches.includes(1)));
  const resolved = useMemo(() => new Map<number, ItemOption>([output, ...inputs].filter((item) => item.tblidx)
    .map((item) => [item.tblidx, { tblidx: item.tblidx, name: item.name, iconName: item.iconName }])), [output, inputs]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      if (catalogMode) await onSubmitCatalog(draft);
      else if (recipe) await onSubmitValues(recipe, {
        ...values,
        // Com troca pendente o banco ainda tem os materiais antigos: as quantidades dele não mudam por aqui.
        outputCount: recipe.pending ? recipe.outputCount : effectiveCount,
        amounts: recipe.pending ? recipe.inputs.map((input) => input.amount) : inputs.map((input) => input.amount),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  const lockBalance = catalogMode && !balanceInCatalog;
  const title = isNew ? "Nova receita" : recipe.output.name;
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="editorModal bpModal wide" role="dialog" aria-modal="true" aria-label={isNew ? "Nova receita" : `Receita #${recipe.id}`}>
      <div className="modalHeader"><div><div className="eyebrow">{`${PROFESSION_BENCH_NAMES[recipe?.base ?? 1] ?? "OFICINA"} · ${isNew ? "RECEITA NOVA" : `RECEITA #${recipe.id}`}`.toUpperCase()}</div><h2>{title}</h2></div>
        <button className="closeButton" type="button" onClick={onClose} aria-label="Fechar">×</button></div>
      <form onSubmit={submit} className="bpForm">
        {editable ? <>
          <div className="bpFormGrid">
            <Field label="Profissão" hint="quem faz na Oficina do Ferreiro">
              <select value={specialization} onChange={(event) => setSpecialization(Number(event.target.value))}>
                <option value={0}>Minerador</option>
                <option value={6}>Minerador · Ferreiro</option>
              </select></Field>
            <Field label="Quantidade produzida" hint={tool ? "ferramenta: sempre 1" : `pilha de ${output.maxStack ?? "?"}`}>
              <input type="number" min={1} max={PROFESSION_LIMITS.maxByte} value={Number.isNaN(effectiveCount) ? "" : effectiveCount} disabled={!!tool || (!catalogMode && recipe?.outputCountFixed)}
                onChange={(event) => setOutputCount(number(event.target.value))} required /></Field>
          </div>
          <Field label="Produz" hint={tool ? `ferramenta de nível ${tool.requiredLevel ?? "?"}` : undefined}>
            <ItemPicker value={output.tblidx} label="o produto" resolved={resolved} onPick={(_, option) => option && setOutput(asItem(option))} /></Field>
          <div className="profInputs">
            <span className="bpFieldLabel">Materiais<em>de 1 a {PROFESSION_LIMITS.maxInputs}</em></span>
            {inputs.map((input, index) => <div key={index} className="profInputRow">
              <ItemPicker value={input.tblidx} label={`o material ${index + 1}`} resolved={resolved}
                onPick={(_, option) => option && setInputs(inputs.map((slot, at) => (at === index ? { ...asItem(option), amount: slot.amount } : slot)))} />
              <input type="number" min={1} max={PROFESSION_LIMITS.maxByte} aria-label={`Quantidade do material ${index + 1}`}
                value={Number.isNaN(input.amount) ? "" : input.amount} required
                onChange={(event) => setInputs(inputs.map((slot, at) => (at === index ? { ...slot, amount: number(event.target.value) } : slot)))} />
              <button type="button" className="catalogClearButton" disabled={inputs.length <= 1} onClick={() => setInputs(inputs.filter((_, at) => at !== index))} aria-label={`Tirar material ${index + 1}`}>×</button>
            </div>)}
            {inputs.length < PROFESSION_LIMITS.maxInputs && <div><button type="button" className="catalogClearButton" onClick={() => setInputs([...inputs, { ...EMPTY_ITEM, amount: 1 }])}>+ Material</button></div>}
          </div>
        </> : recipe && <div className="readonlyNotice"><strong>Fixa no código do servidor</strong>
          <span>{professionLabel(recipe.base, recipe.specialization)} · produz {recipe.output.name} (#{recipe.output.tblidx}) · materiais {recipe.inputs.map((input) => input.name).join(", ")}. Esta receita não está no miner-catalog.json; só nível, tempo, XP e quantidades mudam por aqui.</span></div>}

        {catalogMode && <div className="readonlyNotice profCatalogNotice"><strong>Vai para o catálogo e precisa de build</strong>
          <span>Profissão, produto e materiais estão compilados no cliente e nos servidores. Salvar grava o miner-catalog.json e o NtlMinerRecipes.h;
            o jogo só muda depois de <code>dbobuildsubserver</code> e <code>dbobuildsubclient</code> e de aplicar no banco aqui no painel.
            {lockBalance ? " Nível, tempo, XP e ativa continuam os do banco: edite depois de salvar." : ""}</span></div>}

        <div className="bpFormGrid">
          <Field label="Nível exigido" hint={balanceInCatalog && tool ? "o da ferramenta" : `1 a ${PROFESSION_LIMITS.maxLevel}`}>
            <input type="number" min={1} max={PROFESSION_LIMITS.maxLevel} value={Number.isNaN(effectiveLevel) ? "" : effectiveLevel} disabled={lockBalance || (balanceInCatalog && !!tool)}
              onChange={(event) => set("requiredLevel", number(event.target.value))} required /></Field>
          <Field label="Tempo (segundos)" hint={formatDuration(values.durationSeconds)}>
            <input type="number" min={1} max={PROFESSION_LIMITS.maxSeconds} value={Number.isNaN(values.durationSeconds) ? "" : values.durationSeconds} disabled={lockBalance}
              onChange={(event) => set("durationSeconds", number(event.target.value))} required /></Field>
          <Field label="XP ao retirar" hint="por unidade do lote">
            <input type="number" min={0} max={PROFESSION_LIMITS.maxExperience} value={Number.isNaN(values.experience) ? "" : values.experience} disabled={lockBalance}
              onChange={(event) => set("experience", number(event.target.value))} required /></Field>
          {!editable && recipe && <>
            <Field label="Quantidade produzida" hint={recipe.outputCountFixed ? "sempre 1" : `pilha de ${recipe.output.maxStack ?? "?"}`}>
              <input type="number" min={1} max={PROFESSION_LIMITS.maxByte} value={Number.isNaN(outputCount) ? "" : outputCount} disabled={recipe.outputCountFixed}
                onChange={(event) => setOutputCount(number(event.target.value))} required /></Field>
            {inputs.map((input, index) => <Field key={input.tblidx} label={`Material ${index + 1}`} hint={`pilha de ${input.maxStack ?? "?"}`}>
              <span className="profMaterialInput"><ItemIcon iconName={input.iconName} size={26} /><span title={`#${input.tblidx}`}>{input.name}</span>
                <input type="number" min={1} max={PROFESSION_LIMITS.maxByte} value={Number.isNaN(input.amount) ? "" : input.amount} required
                  onChange={(event) => setInputs(inputs.map((slot, at) => (at === index ? { ...slot, amount: number(event.target.value) } : slot)))} /></span></Field>)}
          </>}
          {!balanceInCatalog && <label className="bpField profToggle"><span className="bpFieldLabel">Receita ativa<em>desativada some para novos pedidos</em></span>
            <input type="checkbox" checked={values.enabled} disabled={lockBalance} onChange={(event) => set("enabled", event.target.checked)} /></label>}
        </div>
        <p className="bpFormNote">
          Lotes: <BatchBadges batches={itemsKnown ? batches : []} />{" "}
          {itemsKnown ? (batches.length ? `o lote de ${batches.at(-1)}x leva ${formatDuration(values.durationSeconds * batches.at(-1)!)} e dá ${formatNumber(values.experience * batches.at(-1)!)} XP.` : "com esses valores a bancada não deixa produzir.") : "escolha os itens para calcular as pilhas."}
          {" "}Ordens já iniciadas continuam com a receita antiga.
        </p>
        {issues.length > 0 && <div className="formError">{catalogMode ? "O catálogo recusaria: " : values.enabled ? "O servidor recusaria esta receita ativa: " : "Inválida (só grava desativada): "}{issues.join(" ")}</div>}
        {error && <div className="formError">{error}</div>}
        <div className="modalActions"><button type="button" className="catalogClearButton" onClick={onClose}>Cancelar</button>
          <button className="primaryButton compact" disabled={busy || blocked}>{busy ? "Salvando..." : catalogMode ? "Salvar no catálogo (precisa de build)" : "Gravar receita"}</button></div>
      </form>
    </section>
  </div>;
}
