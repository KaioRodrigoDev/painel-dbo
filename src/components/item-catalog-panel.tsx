"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { ItemDraftCreator } from "@/components/item-draft-creator";
import { getItemCreationDefinition } from "@/lib/item-creation-definitions";

import type { GambleRewardsResponse, ItemCatalogEntry, ItemCatalogResponse } from "@/lib/types";
import { Pagination } from "@/components/pagination";

const RANK_NAMES: Record<number, string> = {
  0: "Sem rank",
  1: "Normal",
  2: "Superior",
  3: "Excelente",
  4: "Raro",
  5: "Lendário",
};

const EQUIP_TYPE_NAMES: Record<number, string> = {
  0: "Arma principal",
  1: "Arma secundária",
  2: "Armadura",
  3: "Scouter",
  4: "Missão",
  5: "Acessório",
  6: "Costume",
  255: "Não equipável",
};

const SLOT_NAMES = [
  "Mão", "Arma secundária", "Jaqueta", "Calça", "Botas", "Scouter", "Missão",
  "Colar", "Brinco 1", "Brinco 2", "Anel 1", "Anel 2", "Costume", "Cabelo",
  "Máscara", "Acessório de cabelo", "Acessório das costas", "Costume de arma secundária",
];

function typeName(value: number) {
  return getItemCreationDefinition(value)?.label ?? `Tipo não mapeado ${value}`;
}

function rankName(value: number) {
  return RANK_NAMES[value] ?? `Rank ${value}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function slotNames(flag: number) {
  const names = SLOT_NAMES.filter((_, index) => (flag & (1 << index)) !== 0);
  return names.length ? names.join(", ") : "Nenhum";
}

const PAGE_SIZES = [40, 80, 120] as const;
type PageSize = (typeof PAGE_SIZES)[number];
const PAGE_SIZE_KEY = "mdbo-admin-items-page-size";

// Preferência só deste navegador; sem localStorage, fica no padrão de 40.
function readPageSize(): PageSize {
  try {
    const saved = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(saved) ? (saved as PageSize) : 40;
  } catch { return 40; }
}

function levelLabel(item: ItemCatalogEntry) {
  return `${item.minimumLevel}${item.maximumLevel && item.maximumLevel !== 255 ? `–${item.maximumLevel}` : ""}`;
}

/** Atributo de 16 bits: 0xFFFF é "não tem" na tabela (ex.: ataque de um chip de scouter). */
function statValue(value: number) {
  return value === 0xffff || value === 0 ? null : value;
}

function durationLabel(seconds: number) {
  if (seconds <= 0 || seconds >= 0xffffffff) return null;
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return seconds % 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds / 60} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** Faixa de nível digitada: vazio é "sem limite"; o resto vai de 0 a 255, como a tabela. */
function parseLevel(value: string) {
  if (value.trim() === "") return "";
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? String(Math.min(255, Math.max(0, number))) : "";
}

function ItemIcon({ item }: { item: ItemCatalogEntry }) {
  const [failed, setFailed] = useState(false);
  if (!item.iconName || failed) {
    return <span className="itemIconPlaceholder">—</span>;
  }
  return <span className="itemIconPlaceholder itemIconLoaded">
    <Image
      src={`/api/items/icons/${encodeURIComponent(item.iconName)}`}
      alt=""
      width={38}
      height={38}
      unoptimized
      onError={() => setFailed(true)}
    />
  </span>;
}

export function ItemCatalogPanel() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const [rank, setRank] = useState("");
  // A faixa de nível vale ao buscar (Enter ou botão), como o texto: digitar "15" não busca "1" antes.
  const [draftMinLevel, setDraftMinLevel] = useState("");
  const [draftMaxLevel, setDraftMaxLevel] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [hovered, setHovered] = useState<{ item: ItemCatalogEntry; rect: DOMRect } | null>(null);
  const [page, setPage] = useState(1);
  // O painel só monta depois da hidratação (a aba vem do hash da URL), então ler o
  // localStorage aqui não diverge do HTML do servidor.
  const [pageSize, setPageSize] = useState<PageSize>(readPageSize);
  const listTop = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ItemCatalogResponse | null>(null);
  const [selected, setSelected] = useState<ItemCatalogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), details: "1" });
    if (search) params.set("search", search);
    if (itemType) params.set("itemType", itemType);
    if (rank) params.set("rank", rank);
    if (minLevel) params.set("minLevel", minLevel);
    if (maxLevel) params.set("maxLevel", maxLevel);

    try {
      const response = await fetch(`/api/items?${params}`, { signal, cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ItemCatalogResponse | { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("error" in body ? body.error : "Falha ao carregar itens.");
      }
      setData(body as ItemCatalogResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar itens.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [itemType, maxLevel, minLevel, page, pageSize, rank, router, search]);

  // O tooltip fica preso na tela (position: fixed); rolar a lista deixaria ele longe do card.
  useEffect(() => {
    if (!hovered) return;
    const hide = () => setHovered(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [hovered]);

  useEffect(() => {
    const controller = new AbortController();
    const request = window.setTimeout(() => {
      void loadItems(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(request);
      controller.abort();
    };
  }, [loadItems]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(draftSearch.trim());
    const from = parseLevel(draftMinLevel);
    const to = parseLevel(draftMaxLevel);
    setDraftMinLevel(from);
    setDraftMaxLevel(to);
    setMinLevel(from);
    setMaxLevel(to);
  }

  function clearFilters() {
    setDraftSearch("");
    setSearch("");
    setItemType("");
    setRank("");
    setDraftMinLevel("");
    setDraftMaxLevel("");
    setMinLevel("");
    setMaxLevel("");
    setPage(1);
  }

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try { window.localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch { /* fica só nesta sessão */ }
  }

  // A paginação de baixo fica longe do topo com 120 cards; trocar de página volta ao começo da lista.
  function goToPage(next: number) {
    setPage(next);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const pagination = data && data.totalPages > 1 && (
    <Pagination page={data.page} totalPages={data.totalPages} disabled={loading} onChange={goToPage} label="Paginação do catálogo" />
  );

  if (creating) return <ItemDraftCreator onBack={() => setCreating(false)} />;

  return (
    <div className="itemCatalogPanel">
      <form className="itemFilters itemCatalogFilters" onSubmit={submitSearch}>
        <div className="searchInputWrap">
          <span aria-hidden="true">⌕</span>
          <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Buscar por nome, TBLIDX, ícone ou modelo" maxLength={80} />
        </div>
        <select value={itemType} onChange={(event) => { setItemType(event.target.value); setPage(1); }} aria-label="Filtrar tipo">
          <option value="">Todos os tipos</option>
          {data?.availableTypes.map((value) => <option key={value} value={value}>{typeName(value)}</option>)}
        </select>
        <select value={rank} onChange={(event) => { setRank(event.target.value); setPage(1); }} aria-label="Filtrar rank">
          <option value="">Todos os ranks</option>
          {data?.availableRanks.map((value) => <option key={value} value={value}>{rankName(value)}</option>)}
        </select>
        <fieldset className="levelRange" title="Nível mínimo exigido para usar o item. Deixe um lado vazio para não limitar.">
          <legend>Nível</legend>
          <input type="number" inputMode="numeric" min={0} max={255} value={draftMinLevel} onChange={(event) => setDraftMinLevel(event.target.value)} placeholder="de" aria-label="Nível a partir de" />
          <span aria-hidden="true">–</span>
          <input type="number" inputMode="numeric" min={0} max={255} value={draftMaxLevel} onChange={(event) => setDraftMaxLevel(event.target.value)} placeholder="até" aria-label="Nível até" />
        </fieldset>
        <button className="primaryButton compact" type="submit">Buscar</button>
        {(search || itemType || rank || minLevel || maxLevel) && <button className="catalogClearButton" type="button" onClick={clearFilters}>Limpar</button>}
      </form>

      <div className="listHeader" ref={listTop}>
        <div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> itens encontrados</span></div>
        <div className="catalogSource">
          <div className="pageSizeSwitch" role="group" aria-label="Itens por página">
            <span>Por página</span>
            {PAGE_SIZES.map((size) => <button key={size} type="button" className={size === pageSize ? "active" : ""} aria-pressed={size === pageSize} onClick={() => changePageSize(size)}>{size}</button>)}
          </div>
          {data && <span>{data.sourceFile} + {data.textSourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}
          <button className="refreshButton" onClick={() => void loadItems()} disabled={loading}>↻ Atualizar</button>
          <button className="primaryButton compact" onClick={() => setCreating(true)}>+ Criar item</button>
        </div>
      </div>

      {error && <div className="errorBanner"><strong>Falha no catálogo</strong><span>{error}</span></div>}
      {loading && <div className="loadingState"><span className="spinner" /> Lendo o catálogo de itens...</div>}
      {!loading && data?.items.length === 0 && <div className="emptyState">Nenhum item corresponde aos filtros.</div>}

      {!loading && data && data.items.length > 0 && <>
        {pagination && <div className="paginationTop">{pagination}</div>}
        {/* O card inteiro abre os detalhes; não há botão separado para isso. */}
        <div className="itemCardGrid">
          {data.items.map((item) => (
            <button
              key={item.tblidx}
              type="button"
              className={`itemCard rank${item.rank}`}
              onClick={() => { setHovered(null); setSelected(item); }}
              onMouseEnter={(event) => setHovered({ item, rect: event.currentTarget.getBoundingClientRect() })}
              onMouseLeave={() => setHovered(null)}
              onFocus={(event) => setHovered({ item, rect: event.currentTarget.getBoundingClientRect() })}
              onBlur={() => setHovered(null)}
              aria-describedby={hovered?.item.tblidx === item.tblidx ? "item-tooltip" : undefined}
            >
              <div className="itemCardHead">
                <ItemIcon item={item} />
                <div><strong>{item.name}</strong><code>#{item.tblidx}</code></div>
              </div>
              <div className="itemCardBadges">
                <span className="catalogBadge">{typeName(item.itemType)}</span>
                <span className={`rankBadge rank${item.rank}`}>{rankName(item.rank)}</span>
              </div>
              <dl className="itemCardFacts">
                <div><dt>Nível</dt><dd>{levelLabel(item)}</dd></div>
                <div><dt>Compra</dt><dd>{formatNumber(item.cost)}</dd></div>
                <div><dt>Venda</dt><dd>{formatNumber(item.sellPrice)}</dd></div>
              </dl>
            </button>
          ))}
        </div>
      </>}

      {pagination}

      {hovered && !selected && <ItemTooltip item={hovered.item} rect={hovered.rect} effectsError={data?.effectsError} />}
      {selected && <ItemDetails item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const TOOLTIP_WIDTH = 300;
const TOOLTIP_GAP = 10;

/**
 * O tooltip do jogo, ao passar o mouse no card: atributos, efeitos da opção e do uso, descrição.
 *
 * Fica ao lado do card (à direita; à esquerda se não couber) e, da metade da tela para baixo,
 * cresce para cima -- assim não precisa medir a própria altura antes de aparecer.
 */
function ItemTooltip({ item, rect, effectsError }: { item: ItemCatalogEntry; rect: DOMRect; effectsError?: string }) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const fitsRight = rect.right + TOOLTIP_GAP + TOOLTIP_WIDTH <= viewportWidth - 8;
  const left = fitsRight ? rect.right + TOOLTIP_GAP : Math.max(8, rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH);
  const vertical = rect.top < viewportHeight / 2
    ? { top: Math.max(8, rect.top) }
    : { bottom: Math.max(8, viewportHeight - rect.bottom) };

  const stats = [
    ["Ataque físico", statValue(item.physicalOffence)],
    ["Ataque de energia", statValue(item.energyOffence)],
    ["Defesa física", statValue(item.physicalDefence)],
    ["Defesa de energia", statValue(item.energyDefence)],
    ["Durabilidade", item.durability === 255 || item.durability === 0 ? null : item.durability],
  ].filter((entry): entry is [string, number] => entry[1] !== null);

  return <div id="item-tooltip" role="tooltip" className={`itemTooltip rank${item.rank}`} style={{ left, width: TOOLTIP_WIDTH, ...vertical }}>
    <div className="itemTooltipHead">
      <ItemIcon item={item} />
      <div><strong>{item.name}</strong><code>#{item.tblidx}</code></div>
    </div>
    <p className="itemTooltipMeta">{typeName(item.itemType)} · {rankName(item.rank)} · Nível {levelLabel(item)}</p>
    {stats.length > 0 && <dl className="itemTooltipStats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatNumber(value)}</dd></div>)}</dl>}
    <ItemEffectsList item={item} effectsError={effectsError} />
    {item.description && <p className="itemTooltipNote">{item.description}</p>}
    <p className="itemTooltipFoot">Compra {formatNumber(item.cost)} · Venda {formatNumber(item.sellPrice)} · clique para os detalhes</p>
  </div>;
}

/** Efeitos da opção fixa e do uso, no texto que o jogo mostra. Some quando o item não tem nenhum. */
function ItemEffectsList({ item, effectsError }: { item: ItemCatalogEntry; effectsError?: string }) {
  if (!item.effects) {
    return effectsError ? <p className="itemEffectsMissing">Efeitos indisponíveis: {effectsError}</p> : null;
  }
  const { option, use } = item.effects;
  const duration = use ? durationLabel(use.durationSeconds) : null;
  const cooldown = use ? durationLabel(use.cooldownSeconds) : null;

  return <>
    {option && <section className="itemEffects">
      <h4>Efeito do item <small>opção #{option.tblidx}</small></h4>
      <ul>{option.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
    </section>}
    {use && <section className="itemEffects use">
      <h4>Ao usar <small>uso #{use.tblidx}</small></h4>
      <ul>{use.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
      {(duration || cooldown) && <p>{[duration && `Duração ${duration}`, cooldown && `Recarga ${cooldown}`].filter(Boolean).join(" · ")}</p>}
    </section>}
  </>;
}

function ItemDetails({ item, onClose }: { item: ItemCatalogEntry; onClose: () => void }) {
  const details = [
    ["TBLIDX", item.tblidx], ["Text ID", item.nameTextId], ["Nome interno", item.internalName || "—"], ["Válido", item.valid ? "Sim" : "Não"],
    ["Tipo", `${typeName(item.itemType)} (${item.itemType})`], ["Equipamento", `${EQUIP_TYPE_NAMES[item.equipType] ?? "Tipo desconhecido"} (${item.equipType})`],
    ["Slots", `${slotNames(item.equipSlotFlag)} (0x${item.equipSlotFlag.toString(16).toUpperCase()})`], ["Rank", `${rankName(item.rank)} (${item.rank})`],
    ["Pilha máxima", item.maxStack], ["Durabilidade", item.durability], ["Peso", item.weight],
    ["Ataque físico", statValue(item.physicalOffence) ?? "—"], ["Ataque de energia", statValue(item.energyOffence) ?? "—"], ["Defesa física", statValue(item.physicalDefence) ?? "—"], ["Defesa de energia", statValue(item.energyDefence) ?? "—"],
    ["Alcance adicional", formatNumber(item.attackRangeBonus)], ["Velocidade de ataque", item.attackSpeedRate],
    ["Nível mínimo", item.minimumLevel], ["Nível máximo", item.maximumLevel], ["Classe (flag)", `0x${item.classFlag.toString(16).toUpperCase()}`], ["Gênero (flag)", `0x${item.genderFlag.toString(16).toUpperCase()}`],
    ["Classe especial", item.classSpecial], ["Raça especial", item.raceSpecial], ["Atributo de batalha", item.battleAttribute],
    ["Preço de compra", formatNumber(item.cost)], ["Preço de venda", formatNumber(item.sellPrice)],
  ];

  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="editorModal itemDetailsModal" role="dialog" aria-modal="true" aria-labelledby="item-details-title">
      <div className="modalHeader"><div><div className="eyebrow">ITEM DO CATÁLOGO</div><h2 id="item-details-title">{item.name}</h2><p>#{item.tblidx} · {item.iconName || "sem ícone"}</p></div><button className="closeButton" onClick={onClose} aria-label="Fechar">×</button></div>
      <div className="modelNames"><span>Modelo <code>{item.modelName || "—"}</code></span><span>Subarma <code>{item.subWeaponModelName || "—"}</code></span></div>
      {item.description && <p className="itemTooltipNote">{item.description}</p>}
      <ItemEffectsList item={item} />
      <div className="itemDetailGrid">{details.map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <GambleRewards item={item} />
      <div className="readonlyNotice"><strong>Consulta somente leitura</strong><span>Esta tela não altera o RDF e não entrega o item a nenhum jogador.</span></div>
    </section>
  </div>;
}

/**
 * O que uma caixa de aposta pode devolver.
 *
 * Só aparece quando o item realmente tem o sorteio ligado -- a API devolve null para tudo o
 * mais e a seção some. O texto do topo muda conforme o modo, porque a diferença entre
 * "entrega um só" e "entrega todos que passarem" muda completamente o que você recebe ao usar.
 */
function GambleRewards({ item }: { item: ItemCatalogEntry }) {
  const [data, setData] = useState<GambleRewardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError(""); setData(null);
    try {
      const response = await fetch(`/api/items/${item.tblidx}/gamble`, { signal, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao carregar os prêmios.");
      setData(body.gamble as GambleRewardsResponse | null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar os prêmios.");
    } finally { if (!signal.aborted) setLoading(false); }
  }, [item.tblidx]);

  useEffect(() => { const controller = new AbortController(); const request = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(request); controller.abort(); }; }, [load]);

  if (loading) return <div className="loadingState"><span className="spinner" /> Verificando se este item sorteia prêmios...</div>;
  if (error) return <div className="errorBanner"><strong>Falha nos prêmios</strong><span>{error}</span></div>;
  if (!data) return null;

  const somaChances = data.rewards.reduce((total, reward) => total + reward.chance, 0);
  const modo = data.drawMode === "one"
    ? "O servidor sorteia e entrega apenas UM prêmio, escolhido entre os que passarem na chance."
    : data.drawMode === "each"
      ? "Cada prêmio é sorteado sozinho: pode vir mais de um de uma vez."
      : "Esta caixa não devolve nada como está.";

  return <section className="gambleSection">
    <div className="dropSectionHead">
      <h3>O que esta aposta pode devolver</h3>
      {data.rewards.length > 0 && <span className="catalogBadge">{data.rewards.length} prêmio{data.rewards.length === 1 ? "" : "s"} possíveis</span>}
      {data.drawMode !== "none" && <span className="dropDrawBadge">{data.drawMode === "one" ? "1 prêmio por uso" : "pode vir mais de um"}</span>}
    </div>
    <p className="dropNote">{modo} Se nenhum passar, o servidor repete o sorteio — então sempre sai alguma coisa.</p>
    {data.warnings.map((warning) => <div className="errorBanner subtle" key={warning}><strong>Atenção</strong><span>{warning}</span></div>)}
    {data.rewards.length > 0 && <ul className="gambleRewardList">
      {data.rewards.map((reward, index) => <li key={`${index}-${reward.tblidx}`} className={reward.missing || reward.unsupportedType ? "dropItemMissing" : undefined}>
        <ItemIcon item={{ ...item, iconName: reward.iconName }} />
        <div>
          <strong>{reward.name}</strong>
          <small>#{reward.tblidx}{reward.minQuantity === reward.maxQuantity ? ` · ${formatNumber(reward.minQuantity)}x` : ` · ${formatNumber(reward.minQuantity)} a ${formatNumber(reward.maxQuantity)}x`}</small>
        </div>
        <em>{reward.chance % 1 === 0 ? reward.chance : reward.chance.toFixed(2)}%</em>
      </li>)}
    </ul>}
    {data.rewards.length > 0 && <p className="dropNote">Soma das chances: {somaChances % 1 === 0 ? somaChances : somaChances.toFixed(2)}% · sorteio #{data.probabilityTblidx} de table_quest_probability_data.rdf</p>}
  </section>;
}
