"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MobCatalogEntry, MobCatalogResponse } from "@/lib/types";

const GRADE_NAMES: Record<number, string> = { 0: "Normal", 1: "Super", 2: "Ultra", 3: "Boss", 4: "Herói" };
const TYPE_NAMES: Record<number, string> = { 0: "Terrestre", 1: "Voador", 2: "Aquático" };
const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const gradeName = (value: number) => GRADE_NAMES[value] ?? `Grau ${value}`;
const typeName = (value: number) => TYPE_NAMES[value] ?? `Tipo ${value}`;

export function MobCatalogPanel() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState(""); const [search, setSearch] = useState("");
  const [grade, setGrade] = useState(""); const [type, setType] = useState(""); const [page, setPage] = useState(1);
  const [data, setData] = useState<MobCatalogResponse | null>(null); const [selected, setSelected] = useState<MobCatalogEntry | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const loadMobs = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search); if (grade) params.set("grade", grade); if (type) params.set("type", type);
    try {
      const response = await fetch(`/api/mobs?${params}`, { signal, cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as MobCatalogResponse | { error?: string };
      if (!response.ok) { if (response.status === 401) { router.push("/login"); return; } throw new Error("error" in body ? body.error : "Falha ao carregar mobs."); }
      setData(body as MobCatalogResponse);
    } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Falha ao carregar mobs."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [grade, page, router, search, type]);
  useEffect(() => { const controller = new AbortController(); const request = window.setTimeout(() => void loadMobs(controller.signal), 0); return () => { window.clearTimeout(request); controller.abort(); }; }, [loadMobs]);
  function clearFilters() { setDraftSearch(""); setSearch(""); setGrade(""); setType(""); setPage(1); }
  return <div className="itemCatalogPanel">
    <form className="itemFilters" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(draftSearch.trim()); }}>
      <div className="searchInputWrap"><span aria-hidden="true">⌕</span><input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Buscar por nome, TBLIDX ou modelo" maxLength={80} /></div>
      <select value={grade} onChange={(event) => { setGrade(event.target.value); setPage(1); }} aria-label="Filtrar grau"><option value="">Todos os graus</option>{data?.availableGrades.map((value) => <option key={value} value={value}>{gradeName(value)}</option>)}</select>
      <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} aria-label="Filtrar tipo"><option value="">Todos os tipos</option>{data?.availableTypes.map((value) => <option key={value} value={value}>{typeName(value)}</option>)}</select>
      <button className="primaryButton compact" type="submit">Buscar</button>{(search || grade || type) && <button className="catalogClearButton" type="button" onClick={clearFilters}>Limpar</button>}
    </form>
    <div className="listHeader"><div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> mobs encontrados</span></div><div className="catalogSource">{data && <span>{data.sourceFile} + {data.textSourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}<button className="refreshButton" onClick={() => void loadMobs()} disabled={loading}>↻ Atualizar</button></div></div>
    {error && <div className="errorBanner"><strong>Falha no catálogo</strong><span>{error}</span></div>}{loading && <div className="loadingState"><span className="spinner" /> Lendo o catálogo de mobs...</div>}{!loading && data?.mobs.length === 0 && <div className="emptyState">Nenhum mob corresponde aos filtros.</div>}
    {!loading && data && data.mobs.length > 0 && <div className="itemTableWrap"><table className="itemTable"><thead><tr><th>TBLIDX</th><th>Mob</th><th>Nível</th><th>Grau</th><th>LP</th><th>Recompensas</th><th /></tr></thead><tbody>{data.mobs.map((mob) => <tr key={mob.tblidx}><td><code>{mob.tblidx}</code></td><td><div className="itemIdentity"><div><strong>{mob.name}</strong><small>{mob.modelName || mob.internalName || "Sem modelo"}</small></div></div></td><td>{mob.level}</td><td><span className="catalogBadge">{gradeName(mob.grade)}</span></td><td>{formatNumber(mob.basicLp)}</td><td><small>EXP {formatNumber(mob.experience)}<br />Zeni {formatNumber(mob.dropZenny)}</small></td><td><button className="catalogDetailsButton" onClick={() => setSelected(mob)}>Detalhes</button></td></tr>)}</tbody></table></div>}
    {data && data.totalPages > 1 && <nav className="pagination" aria-label="Paginação do catálogo de mobs"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Anterior</button><span>Página <strong>{data.page}</strong> de {data.totalPages}</span><button disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Próxima →</button></nav>}
    {selected && <MobDetails mob={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function MobDetails({ mob, onClose }: { mob: MobCatalogEntry; onClose: () => void }) {
  const details = [["TBLIDX", mob.tblidx], ["Text ID", mob.nameTextId], ["Nome interno", mob.internalName || "—"], ["Válido", mob.valid ? "Sim" : "Não"], ["Nível", mob.level], ["Grau", `${gradeName(mob.grade)} (${mob.grade})`], ["Tipo", `${typeName(mob.mobType)} (${mob.mobType})`], ["Espécie", mob.mobKind], ["Grupo", mob.mobGroup], ["Classe", mob.monsterClass], ["LP", formatNumber(mob.basicLp)], ["EP", formatNumber(mob.basicEp)], ["Ataque físico", mob.physicalOffence], ["Ataque de energia", mob.energyOffence], ["Defesa física", mob.physicalDefence], ["Defesa de energia", mob.energyDefence], ["Taxa de ataque", mob.attackRate], ["Esquiva", mob.dodgeRate], ["Bloqueio", mob.blockRate], ["Velocidade de ataque", mob.attackSpeedRate], ["Alcance", formatNumber(mob.attackRange)], ["Visão / detecção", `${mob.sightRange} / ${mob.scanRange}`], ["Caminhada / corrida", `${formatNumber(mob.walkSpeed)} / ${formatNumber(mob.runSpeed)}`], ["Experiência", formatNumber(mob.experience)], ["Zeni", formatNumber(mob.dropZenny)], ["Taxa de zeni", formatNumber(mob.dropZennyRate)], ["Atributo de batalha", mob.battleAttribute], ["Aliança", mob.allianceId], ["Exibe nome", mob.showName ? "Sim" : "Não"], ["Drop Dragon Ball", mob.dragonBallDrop ? "Sim" : "Não"]];
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="editorModal itemDetailsModal" role="dialog" aria-modal="true" aria-labelledby="mob-details-title"><div className="modalHeader"><div><div className="eyebrow">MOB DO CATÁLOGO</div><h2 id="mob-details-title">{mob.name}</h2><p>#{mob.tblidx} · {mob.modelName || "sem modelo"}</p></div><button className="closeButton" onClick={onClose} aria-label="Fechar">×</button></div><div className="itemDetailGrid">{details.map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="readonlyNotice"><strong>Consulta somente leitura</strong><span>Esta tela não altera o RDF nem os mobs ativos no servidor.</span></div></section></div>;
}
