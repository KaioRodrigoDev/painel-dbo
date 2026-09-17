"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { DeliveriesResponse, DeliveryEntry } from "@/lib/types";

const labels: Record<string, string> = {
  pending: "Na fila", processing: "Processando", applied: "Disponível",
  claimed: "Recebido", failed: "Falhou",
};

function date(value: string | null) {
  if (!value) return "Horário não registrado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function recipient(entry: DeliveryEntry) {
  if (entry.channel === "cashshop") return "Todos os personagens da conta";
  return entry.characterName ? `${entry.characterName} (#${entry.characterId})` : `Personagem #${entry.characterId}`;
}

export function DeliveryHistoryPanel() {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DeliveriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ channel, status, page: String(page) });
    if (search) params.set("search", search);
    try {
      const response = await fetch(`/api/deliveries?${params}`, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao carregar envios.");
      setData(body);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar envios.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [channel, page, search, status]);

  useEffect(() => {
    const controller = new AbortController();
    const request = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(request); controller.abort(); };
  }, [load]);

  function submit(event: FormEvent) { event.preventDefault(); setPage(1); setSearch(draftSearch.trim()); }

  return <div className="deliveryHistory">
    <form className="deliveryToolbar" onSubmit={submit}>
      <div className="searchInputWrap"><span>⌕</span><input value={draftSearch} onChange={event => setDraftSearch(event.target.value)} placeholder="Conta, personagem, item ou TBLIDX" /></div>
      <select value={channel} onChange={event => { setChannel(event.target.value); setPage(1); }}><option value="all">Todos os canais</option><option value="mail">Correio</option><option value="cashshop">Cash Shop</option></select>
      <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">Todos os estados</option><option value="claimed">Recebidos</option><option value="applied">Disponíveis</option><option value="pending">Na fila</option><option value="processing">Processando</option><option value="failed">Falhas</option></select>
      <button className="primaryButton compact" type="submit">Buscar</button>
      <button className="refreshButton" type="button" onClick={() => void load()} disabled={loading}>↻ Atualizar</button>
    </form>
    {data && <div className="deliveryStats">
      <article><small>ENVIOS</small><strong>{data.counts.total}</strong></article>
      <article className="received"><small>RECEBIDOS</small><strong>{data.counts.claimed}</strong></article>
      <article><small>DISPONÍVEIS</small><strong>{data.counts.available}</strong></article>
      <article className="failed"><small>FALHAS</small><strong>{data.counts.failed}</strong></article>
    </div>}
    {error && <div className="errorBanner"><strong>Falha na consulta</strong><span>{error}</span></div>}
    {loading && <div className="loadingState"><span className="spinner" /> Consultando histórico de envios...</div>}
    {!loading && data?.deliveries.length === 0 && <div className="emptyState">Nenhum envio encontrado.</div>}
    {!loading && data && data.deliveries.length > 0 && <div className="deliveryTableWrap"><table className="deliveryTable"><thead><tr><th>Estado</th><th>Destino</th><th>Item</th><th>Canal</th><th>Enviado</th><th>Comprovante</th></tr></thead><tbody>
      {data.deliveries.map(entry => <tr key={`${entry.channel}-${entry.id}`}>
        <td><span className={`deliveryStatus ${entry.status}`}>{labels[entry.status] ?? entry.status}</span>{entry.errorMessage && <small className="deliveryError">{entry.errorMessage}</small>}</td>
        <td><strong>{entry.username ?? `Conta #${entry.accountId}`}</strong><small>Conta #{entry.accountId} · {recipient(entry)}</small></td>
        <td><strong>{entry.quantity}× {entry.itemName}</strong><small>TBLIDX {entry.itemTblidx}{entry.itemInstanceId ? ` · Item ${entry.itemInstanceId}` : ""}</small></td>
        <td><span className={`deliveryChannel ${entry.channel}`}>{entry.channel === "mail" ? "Correio" : "Cash Shop"}</span><small>por {entry.requestedBy}</small></td>
        <td><strong>{date(entry.createdAt)}</strong><small>{entry.deliveryId ? `${entry.channel === "mail" ? "Mail" : "Product"} #${entry.deliveryId}` : "Aguardando ID"}</small></td>
        <td>{entry.status === "claimed" ? <><strong className="claimedText">✓ Recebido</strong><small>{date(entry.claimedAt)}{entry.claimedByCharacterId ? ` · Char #${entry.claimedByCharacterId}` : ""}</small></> : <><strong>{entry.channel === "cashshop" && entry.status === "applied" ? "Disponível na conta" : "—"}</strong><small>{entry.channel === "cashshop" ? "O Cash Shop não informa retirada" : "Aguardando resgate"}</small></>}</td>
      </tr>)}
    </tbody></table></div>}
    {data && data.totalPages > 1 && <nav className="pagination"><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>← Anterior</button><span>Página <strong>{data.page}</strong> de {data.totalPages}</span><button disabled={page >= data.totalPages || loading} onClick={() => setPage(value => value + 1)}>Próxima →</button></nav>}
  </div>;
}
