"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { DropEditorPage } from "@/components/drop-editor";
import { MobSkillsPage } from "@/components/mob-skill-editor";
import type { MobCatalogEntry, MobCatalogResponse, MobDropGroup, MobDropItem, MobDropsResponse } from "@/lib/types";

const GRADE_NAMES: Record<number, string> = { 0: "Normal", 1: "Super", 2: "Ultra", 3: "Boss", 4: "Herói" };
// eMOB_TYPE, em DboShared/NtlShared2/NtlCharacter.h. A ordem e os 16 valores vêm de lá.
const TYPE_NAMES: Record<number, string> = { 0: "Animal", 1: "Humanoide", 2: "Dinossauro", 3: "Alienígena", 4: "Andróide", 5: "Robô", 6: "Dragão", 7: "Demônio", 8: "Morto-vivo", 9: "Planta", 10: "Inseto", 11: "Humano", 12: "Namekuseijin", 13: "Majin", 14: "Construção", 15: "Caixa de item" };
const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const gradeName = (value: number) => GRADE_NAMES[value] ?? `Grau ${value}`;
const typeName = (value: number) => TYPE_NAMES[value] ?? `Tipo ${value}`;

export function MobCatalogPanel() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState(""); const [search, setSearch] = useState("");
  const [grade, setGrade] = useState(""); const [type, setType] = useState(""); const [page, setPage] = useState(1);
  const [data, setData] = useState<MobCatalogResponse | null>(null); const [selected, setSelected] = useState<MobCatalogEntry | null>(null);
  // A aba tem tres niveis: a lista, os drops de um mob e a edicao de um registro. Cada um
  // ocupa a tela inteira e o anterior fica guardado no estado, para o voltar devolver o
  // operador ao ponto de onde saiu em vez de reiniciar a navegacao.
  const [dropsMob, setDropsMob] = useState<MobCatalogEntry | null>(null);
  const [skillsMob, setSkillsMob] = useState<MobCatalogEntry | null>(null);
  const [editingDrop, setEditingDrop] = useState<{ target: "group" | "bag"; tblidx: number; origin: MobCatalogEntry } | null>(null);
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

  if (editingDrop) return <DropEditorPage
    target={editingDrop.target}
    tblidx={editingDrop.tblidx}
    originLabel={`drops de ${editingDrop.origin.name}`}
    onBack={() => { setDropsMob(editingDrop.origin); setEditingDrop(null); }}
  />;

  if (skillsMob) return <MobSkillsPage mob={skillsMob} onBack={() => setSkillsMob(null)} />;

  if (dropsMob) return <MobDropsPage
    mob={dropsMob}
    onBack={() => setDropsMob(null)}
    onEditDrop={(target, tblidx) => { setEditingDrop({ target, tblidx, origin: dropsMob }); setDropsMob(null); }}
  />;

  return <div className="itemCatalogPanel">
    <form className="itemFilters" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(draftSearch.trim()); }}>
      <div className="searchInputWrap"><span aria-hidden="true">⌕</span><input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Buscar por nome, TBLIDX ou modelo" maxLength={80} /></div>
      <select value={grade} onChange={(event) => { setGrade(event.target.value); setPage(1); }} aria-label="Filtrar grau"><option value="">Todos os graus</option>{data?.availableGrades.map((value) => <option key={value} value={value}>{gradeName(value)}</option>)}</select>
      <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} aria-label="Filtrar tipo"><option value="">Todos os tipos</option>{data?.availableTypes.map((value) => <option key={value} value={value}>{typeName(value)}</option>)}</select>
      <button className="primaryButton compact" type="submit">Buscar</button>{(search || grade || type) && <button className="catalogClearButton" type="button" onClick={clearFilters}>Limpar</button>}
    </form>
    <div className="listHeader"><div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> mobs encontrados</span></div><div className="catalogSource">{data && <span>{data.sourceFile} + {data.textSourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}<button className="refreshButton" onClick={() => void loadMobs()} disabled={loading}>↻ Atualizar</button></div></div>
    {error && <div className="errorBanner"><strong>Falha no catálogo</strong><span>{error}</span></div>}{loading && <div className="loadingState"><span className="spinner" /> Lendo o catálogo de mobs...</div>}{!loading && data?.mobs.length === 0 && <div className="emptyState">Nenhum mob corresponde aos filtros.</div>}
    {!loading && data && data.mobs.length > 0 && <div className="itemTableWrap"><table className="itemTable"><thead><tr><th>TBLIDX</th><th>Mob</th><th>Nível</th><th>Grau</th><th>LP</th><th>Recompensas</th><th /></tr></thead><tbody>{data.mobs.map((mob) => <tr key={mob.tblidx}><td><code>{mob.tblidx}</code></td><td><div className="itemIdentity"><div><strong>{mob.name}</strong><small>{mob.modelName || mob.internalName || "Sem modelo"}</small></div></div></td><td>{mob.level}</td><td><span className="catalogBadge">{gradeName(mob.grade)}</span></td><td>{formatNumber(mob.basicLp)}</td><td><small>EXP {formatNumber(mob.experience)}<br />Zeni {formatNumber(mob.dropZenny)}</small></td><td><div className="catalogRowActions"><button className="catalogDetailsButton" onClick={() => setDropsMob(mob)}>Drops</button><button className="catalogDetailsButton" onClick={() => setSkillsMob(mob)}>Skills</button><button className="catalogDetailsButton" onClick={() => setSelected(mob)}>Detalhes</button></div></td></tr>)}</tbody></table></div>}
    {data && data.totalPages > 1 && <nav className="pagination" aria-label="Paginação do catálogo de mobs"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Anterior</button><span>Página <strong>{data.page}</strong> de {data.totalPages}</span><button disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Próxima →</button></nav>}
    {selected && <MobDetails mob={selected} onClose={() => setSelected(null)} onOpenDrops={() => { setDropsMob(selected); setSelected(null); }} onOpenSkills={() => { setSkillsMob(selected); setSelected(null); }} />}
  </div>;
}

function DropIcon({ item }: { item: MobDropItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.iconName || failed) return <span className="dropItemIcon">—</span>;
  return <span className="dropItemIcon"><Image src={`/api/items/icons/${encodeURIComponent(item.iconName)}`} alt="" width={26} height={26} unoptimized onError={() => setFailed(true)} /></span>;
}

/**
 * Um grupo de drop, fechado por padrao fora da secao exclusiva do mob.
 *
 * O corpo so e montado quando o grupo abre. Um mob de campo no nivel 40 alcanca cinco
 * grupos de regiao, e montar todos de uma vez colocava ~950 itens (e ~950 <img>) no DOM de
 * um modal so -- com `<details>` puro o React monta os filhos mesmo fechado.
 */
function DropGroupCard({ group, startOpen, onEdit }: { group: MobDropGroup; startOpen: boolean; onEdit: (target: "group" | "bag", tblidx: number) => void }) {
  const [open, setOpen] = useState(startOpen);
  const itemCount = group.bags.reduce((total, bag) => total + bag.items.length, 0);
  return <details className="dropGroup" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <strong>{group.name}</strong>
      <small>#{group.tblidx} · nível {group.level === 255 ? "qualquer" : group.level} · {group.tryCount}× por morte · {formatNumber(itemCount)} itens</small>
      {/* dentro do <summary> um clique abriria/fecharia o grupo junto, daí o stopPropagation */}
      <button className="dropEditButton" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEdit("group", group.tblidx); }}>Editar grupo</button>
    </summary>
    {open && <>
      {group.uniformDraw
        ? <p className="dropNote">Sorteia <strong>1 item</strong> entre todos os listados, com peso igual — as probabilidades abaixo não valem neste grupo. Repete {group.tryCount}× por morte.</p>
        : <p className="dropNote">Cada bag é testada pela probabilidade dela; passando, cada item é testado pela sua. A taxa de drop do servidor multiplica as duas.</p>}
      {/* Não são porcentagens: em CItemDrop::GenerateRank a taxa sai de `1000 - valor/10`.
          Com os quatro em zero o servidor aplica os padrões dele (4/2/1/0,5% com multiplicador
          de masmorra), então mostrar "0%" seria o oposto do que acontece. */}
      {(group.superior > 0 || group.excellent > 0 || group.rare > 0 || group.legendary > 0) && <p className="dropNote">Raridade (valor bruto da tabela) — superior {group.superior} · excelente {group.excellent} · raro {group.rare} · lendário {group.legendary}</p>}
      {/* Um grupo pode listar a mesma bag em varias posicoes, com probabilidades diferentes
          (o grupo 330 repete a bag 343 tres vezes), entao a chave precisa da posicao. */}
      {group.bags.map((bag, slot) => <div className="dropBag" key={`${group.tblidx}-${slot}-${bag.tblidx}`}>
        <div className="dropBagHead">
          <strong>{bag.name}</strong>
          <small>#{bag.tblidx}{bag.enchantAble ? " · encantável" : ""}</small>
          {!group.uniformDraw && <span className="dropProb">{bag.probability}%</span>}
          {!bag.missing && <button className="dropEditButton" type="button" onClick={() => onEdit("bag", bag.tblidx)}>Editar bag</button>}
        </div>
        {bag.missing
          ? <p className="dropNote">Esta bag é referenciada pelo grupo mas não existe em table_item_bag_list_data.rdf — o servidor ignora.</p>
          : <ul className="dropItems">{bag.items.map((item, index) => <li key={`${slot}-${bag.tblidx}-${index}-${item.tblidx}`} className={item.missing ? "dropItemMissing" : undefined}>
            <DropIcon item={item} />
            <span className="dropItemName">{item.name}</span>
            <code>{item.tblidx}</code>
            {!group.uniformDraw && <em>{item.probability}%</em>}
          </li>)}</ul>}
      </div>)}
    </>}
  </details>;
}

/**
 * Os itens que um mob pode largar, como pagina inteira.
 *
 * A leitura e feita pelo mesmo caminho do GameServer, entao a tela mostra os tres tipos de
 * origem separados: o que e exclusivo do mob, o que vem da regra do mundo onde ele morre e,
 * so para caixas, o que vem do tipo. O texto de cada secao explica o sorteio, porque a
 * diferenca entre "roda sempre" e "um grupo sorteado" muda completamente a chance real.
 *
 * Isto morava dentro do modal de detalhes do mob. Um mob de campo alcanca cinco grupos de
 * regiao com centenas de itens somados, e os botoes de edicao ficavam presos la dentro --
 * era preciso abrir o modal para chegar neles. Na pagina cabe tudo e a edicao fica a um
 * clique da lista.
 */
function MobDropsPage({ mob, onBack, onEditDrop }: { mob: MobCatalogEntry; onBack: () => void; onEditDrop: (target: "group" | "bag", tblidx: number) => void }) {
  const router = useRouter();
  const [data, setData] = useState<MobDropsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDrops = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError(""); setData(null);
    try {
      const response = await fetch(`/api/mobs/${mob.tblidx}/drops`, { signal, cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as MobDropsResponse | { error?: string };
      if (!response.ok) { if (response.status === 401) { router.push("/login"); return; } throw new Error("error" in body ? body.error : "Falha ao carregar os drops."); }
      setData(body as MobDropsResponse);
    } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Falha ao carregar os drops."); }
    finally { if (!signal.aborted) setLoading(false); }
  }, [mob.tblidx, router]);
  useEffect(() => { const controller = new AbortController(); const request = window.setTimeout(() => void loadDrops(controller.signal), 0); return () => { window.clearTimeout(request); controller.abort(); }; }, [loadDrops]);

  const distinct = data ? new Set(data.sections.flatMap((section) => section.groups).flatMap((group) => group.bags).flatMap((bag) => bag.items).map((item) => item.tblidx)).size : 0;

  const groupCount = data?.sections.reduce((total, section) => total + section.groups.length, 0) ?? 0;

  return <div className="dropEditorPage">
    <div className="draftCreatorHeader">
      <div>
        <div className="eyebrow">DROPS DO MOB</div>
        <h2>{mob.name}</h2>
        <p>#{mob.tblidx} · nível {mob.level} · {gradeName(mob.grade)} · {typeName(mob.mobType)}</p>
      </div>
      <div className="dropPageHeaderActions">
        <button className="refreshButton" type="button" onClick={() => void loadDrops(new AbortController().signal)} disabled={loading}>↻ Atualizar</button>
        <button className="catalogClearButton" type="button" onClick={onBack}>← Voltar ao catálogo</button>
      </div>
    </div>

    <div className="dropPageSummary">
      <div><small>Itens distintos</small><strong>{data ? formatNumber(distinct) : "—"}</strong></div>
      <div><small>Grupos que alcançam o mob</small><strong>{data ? formatNumber(groupCount) : "—"}</strong></div>
      <div><small>Zeni</small><strong>{formatNumber(mob.dropZenny)} · taxa {formatNumber(mob.dropZennyRate)}</strong></div>
      <div><small>Dragon Ball</small><strong>{mob.dragonBallDrop ? "Sim" : "Não"}</strong></div>
      <div><small>Janela de nível dos grupos de região</small><strong>{data ? `${data.levelWindow.floor} a ${data.levelWindow.ceiling}` : "—"}</strong></div>
    </div>

    {loading && <div className="loadingState"><span className="spinner" /> Lendo as tabelas de drop...</div>}
    {error && <div className="errorBanner"><strong>Falha nos drops</strong><span>{error}</span></div>}
    {data?.warnings.map((warning) => <div className="errorBanner subtle" key={warning}><strong>Dado inconsistente na tabela</strong><span>{warning}</span></div>)}
    {data && data.sections.length === 0 && <div className="emptyState">Nenhum grupo de drop alcança este mob. Ele larga apenas zeni, se tiver.</div>}
    {data?.sections.map((section) => <article className="dropOrigin" key={`${section.source}-${section.ruleName ?? ""}`}>
      <header>
        <strong>{section.label}</strong>
        {section.ruleName && <span className="catalogBadge">{section.ruleName}</span>}
        {section.drawsOneGroup && <span className="dropDrawBadge">1 grupo sorteado</span>}
      </header>
      <p className="dropNote">{section.note}</p>
      {/* Na seção exclusiva todos os grupos rodam a cada morte, então todos abrem. Nas outras
          o servidor sorteia um, e os demais são alternativas: abre só o primeiro. */}
      {section.groups.map((group, index) => <DropGroupCard key={group.tblidx} group={group} startOpen={section.source === "mob" || index === 0} onEdit={onEditDrop} />)}
    </article>)}
  </div>;
}

function MobDetails({ mob, onClose, onOpenDrops, onOpenSkills }: { mob: MobCatalogEntry; onClose: () => void; onOpenDrops: () => void; onOpenSkills: () => void }) {
  const details = [["TBLIDX", mob.tblidx], ["Text ID", mob.nameTextId], ["Nome interno", mob.internalName || "—"], ["Válido", mob.valid ? "Sim" : "Não"], ["Nível", mob.level], ["Grau", `${gradeName(mob.grade)} (${mob.grade})`], ["Tipo", `${typeName(mob.mobType)} (${mob.mobType})`], ["Espécie", mob.mobKind], ["Grupo", mob.mobGroup], ["Classe", mob.monsterClass], ["LP", formatNumber(mob.basicLp)], ["EP", formatNumber(mob.basicEp)], ["Ataque físico", mob.physicalOffence], ["Ataque de energia", mob.energyOffence], ["Defesa física", mob.physicalDefence], ["Defesa de energia", mob.energyDefence], ["Taxa de ataque", mob.attackRate], ["Esquiva", mob.dodgeRate], ["Bloqueio", mob.blockRate], ["Velocidade de ataque", mob.attackSpeedRate], ["Alcance", formatNumber(mob.attackRange)], ["Visão / detecção", `${mob.sightRange} / ${mob.scanRange}`], ["Caminhada / corrida", `${formatNumber(mob.walkSpeed)} / ${formatNumber(mob.runSpeed)}`], ["Experiência", formatNumber(mob.experience)], ["Zeni", formatNumber(mob.dropZenny)], ["Taxa de zeni", formatNumber(mob.dropZennyRate)], ["Atributo de batalha", mob.battleAttribute], ["Aliança", mob.allianceId], ["Exibe nome", mob.showName ? "Sim" : "Não"], ["Drop Dragon Ball", mob.dragonBallDrop ? "Sim" : "Não"]];
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="editorModal itemDetailsModal" role="dialog" aria-modal="true" aria-labelledby="mob-details-title"><div className="modalHeader"><div><div className="eyebrow">MOB DO CATÁLOGO</div><h2 id="mob-details-title">{mob.name}</h2><p>#{mob.tblidx} · {mob.modelName || "sem modelo"}</p></div><button className="closeButton" onClick={onClose} aria-label="Fechar">×</button></div><div className="itemDetailGrid">{details.map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="readonlyNotice"><strong>Consulta somente leitura</strong><span>Esta tela não altera o RDF nem os mobs ativos no servidor.</span></div><div className="modalActions"><button className="secondaryButton" type="button" onClick={onOpenSkills}>Skills do mob →</button><button className="primaryButton" type="button" onClick={onOpenDrops}>Ver e editar os drops →</button></div></section></div>;
}
