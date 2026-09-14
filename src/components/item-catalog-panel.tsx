"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { ItemDraftCreator } from "@/components/item-draft-creator";
import { getItemCreationDefinition } from "@/lib/item-creation-definitions";

import type { ItemCatalogEntry, ItemCatalogResponse } from "@/lib/types";

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
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItemCatalogResponse | null>(null);
  const [selected, setSelected] = useState<ItemCatalogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (itemType) params.set("itemType", itemType);
    if (rank) params.set("rank", rank);

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
  }, [itemType, page, rank, router, search]);

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
  }

  function clearFilters() {
    setDraftSearch("");
    setSearch("");
    setItemType("");
    setRank("");
    setPage(1);
  }

  if (creating) return <ItemDraftCreator onBack={() => setCreating(false)} />;

  return (
    <div className="itemCatalogPanel">
      <form className="itemFilters" onSubmit={submitSearch}>
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
        <button className="primaryButton compact" type="submit">Buscar</button>
        {(search || itemType || rank) && <button className="catalogClearButton" type="button" onClick={clearFilters}>Limpar</button>}
      </form>

      <div className="listHeader">
        <div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> itens encontrados</span></div>
        <div className="catalogSource">
          {data && <span>{data.sourceFile} + {data.textSourceFile} · {new Date(data.sourceUpdatedAt).toLocaleString("pt-BR")}</span>}
          <button className="refreshButton" onClick={() => void loadItems()} disabled={loading}>↻ Atualizar</button>
          <button className="primaryButton compact" onClick={() => setCreating(true)}>+ Criar item</button>
        </div>
      </div>

      {error && <div className="errorBanner"><strong>Falha no catálogo</strong><span>{error}</span></div>}
      {loading && <div className="loadingState"><span className="spinner" /> Lendo o catálogo de itens...</div>}
      {!loading && data?.items.length === 0 && <div className="emptyState">Nenhum item corresponde aos filtros.</div>}

      {!loading && data && data.items.length > 0 && (
        <div className="itemTableWrap">
          <table className="itemTable">
            <thead><tr><th>TBLIDX</th><th>Item</th><th>Tipo</th><th>Rank</th><th>Nível</th><th>Valores</th><th /></tr></thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.tblidx}>
                  <td><code>{item.tblidx}</code></td>
                  <td><div className="itemIdentity"><ItemIcon item={item} /><div><strong>{item.name}</strong><small>{item.iconName || "Sem ícone informado"}</small></div></div></td>
                  <td><span className="catalogBadge">{typeName(item.itemType)}</span></td>
                  <td><span className={`rankBadge rank${item.rank}`}>{rankName(item.rank)}</span></td>
                  <td>{item.minimumLevel}{item.maximumLevel && item.maximumLevel !== 255 ? `–${item.maximumLevel}` : ""}</td>
                  <td><small>Compra {formatNumber(item.cost)}<br />Venda {formatNumber(item.sellPrice)}</small></td>
                  <td><button className="catalogDetailsButton" onClick={() => setSelected(item)}>Detalhes</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <nav className="pagination" aria-label="Paginação do catálogo">
          <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Anterior</button>
          <span>Página <strong>{data.page}</strong> de {data.totalPages}</span>
          <button disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Próxima →</button>
        </nav>
      )}

      {selected && <ItemDetails item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ItemDetails({ item, onClose }: { item: ItemCatalogEntry; onClose: () => void }) {
  const details = [
    ["TBLIDX", item.tblidx], ["Text ID", item.nameTextId], ["Nome interno", item.internalName || "—"], ["Válido", item.valid ? "Sim" : "Não"],
    ["Tipo", `${typeName(item.itemType)} (${item.itemType})`], ["Equipamento", `${EQUIP_TYPE_NAMES[item.equipType] ?? "Tipo desconhecido"} (${item.equipType})`],
    ["Slots", `${slotNames(item.equipSlotFlag)} (0x${item.equipSlotFlag.toString(16).toUpperCase()})`], ["Rank", `${rankName(item.rank)} (${item.rank})`],
    ["Pilha máxima", item.maxStack], ["Durabilidade", item.durability], ["Peso", item.weight],
    ["Ataque físico", item.physicalOffence], ["Ataque de energia", item.energyOffence], ["Defesa física", item.physicalDefence], ["Defesa de energia", item.energyDefence],
    ["Alcance adicional", formatNumber(item.attackRangeBonus)], ["Velocidade de ataque", item.attackSpeedRate],
    ["Nível mínimo", item.minimumLevel], ["Nível máximo", item.maximumLevel], ["Classe (flag)", `0x${item.classFlag.toString(16).toUpperCase()}`], ["Gênero (flag)", `0x${item.genderFlag.toString(16).toUpperCase()}`],
    ["Classe especial", item.classSpecial], ["Raça especial", item.raceSpecial], ["Atributo de batalha", item.battleAttribute],
    ["Preço de compra", formatNumber(item.cost)], ["Preço de venda", formatNumber(item.sellPrice)],
  ];

  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="editorModal itemDetailsModal" role="dialog" aria-modal="true" aria-labelledby="item-details-title">
      <div className="modalHeader"><div><div className="eyebrow">ITEM DO CATÁLOGO</div><h2 id="item-details-title">{item.name}</h2><p>#{item.tblidx} · {item.iconName || "sem ícone"}</p></div><button className="closeButton" onClick={onClose} aria-label="Fechar">×</button></div>
      <div className="modelNames"><span>Modelo <code>{item.modelName || "—"}</code></span><span>Subarma <code>{item.subWeaponModelName || "—"}</code></span></div>
      <div className="itemDetailGrid">{details.map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <div className="readonlyNotice"><strong>Consulta somente leitura</strong><span>Esta tela não altera o RDF e não entrega o item a nenhum jogador.</span></div>
    </section>
  </div>;
}
