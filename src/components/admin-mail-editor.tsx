"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccountSummary, ItemCatalogEntry, ItemCatalogResponse } from "@/lib/types";

export function AdminMailEditor({ account, onClose, onSaved }: {
  account: AccountSummary;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const firstCharacter = account.characters.length > 0
    ? account.characters.reduce((first, character) => character.charId < first.charId ? character : first)
    : undefined;
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ItemCatalogEntry[]>([]);
  const [selected, setSelected] = useState<ItemCatalogEntry | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("Obrigado por apoiar o Dbo World!");
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/items?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as ItemCatalogResponse | { error?: string };
        if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao buscar itens.");
        setResults((body as ItemCatalogResponse).items.filter(item => item.valid).slice(0, 8));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao buscar itens.");
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  function choose(item: ItemCatalogEntry) {
    setSelected(item); setQuantity(1); setSearch(item.name); setResults([]); setError("");
    requestKey.current = crypto.randomUUID();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !firstCharacter || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/accounts/${account.accountId}/mail`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: requestKey.current, itemTblidx: selected.tblidx, quantity, message }),
      });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error ?? "Falha ao registrar envio.");
      onSaved(body.message ?? "Envio registrado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); setPending(false); }
  }

  const maxQuantity = Math.max(1, selected?.maxStack ?? 1);
  return <dialog ref={dialog} className="editorModal vipDialog mailEditorDialog" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="mail-editor-title">
    <div className="modalHeader"><div><div className="eyebrow">CORREIO VIP</div><h2 id="mail-editor-title">Enviar item</h2><p>{account.username} · Conta #{account.accountId} · VIP {account.vip}</p></div><button className="closeButton" onClick={onClose} disabled={pending} aria-label="Fechar">×</button></div>
    <form onSubmit={send}>
      <div className="readonlyNotice"><strong>Primeiro personagem da conta</strong><span>{firstCharacter ? `${firstCharacter.name} · Personagem #${firstCharacter.charId}` : "Esta conta não possui personagens"}</span></div>
      <label className="mailField mailItemSearch">Item do catálogo<input value={search} onChange={event => { setSearch(event.target.value); setSelected(null); setResults([]); }} placeholder="Digite o nome ou TBLIDX" maxLength={80} autoComplete="off" required />{searching && <span className="mailSearchStatus">Buscando...</span>}
        {results.length > 0 && <div className="mailSearchResults">{results.map(item => <button type="button" key={item.tblidx} onClick={() => choose(item)}><span><strong>{item.name}</strong><small>TBLIDX {item.tblidx} · Rank {item.rank}</small></span><em>Máx. {Math.max(1, item.maxStack)}</em></button>)}</div>}
      </label>
      {selected && <div className="selectedMailItem"><span>✓</span><div><strong>{selected.name}</strong><small>TBLIDX {selected.tblidx} · Pilha máxima {maxQuantity}</small></div></div>}
      <div className="formGrid mailFormGrid"><label>Quantidade<input type="number" min={1} max={maxQuantity} value={quantity} onChange={event => { setQuantity(Number(event.target.value)); requestKey.current = crypto.randomUUID(); }} required /></label><label>Remetente<input value="DBO Admin" disabled /></label></div>
      <label className="mailField">Mensagem<textarea value={message} onChange={event => { setMessage(event.target.value); requestKey.current = crypto.randomUUID(); }} maxLength={120} rows={3} required /><small>{message.length}/120 caracteres</small></label>
      <div className="readonlyNotice"><strong>Entrega selada pelo QueryServer</strong><span>O item será enviado em um ovo negociável ao primeiro personagem da conta. Caixas com 30 mensagens não aceitam novos envios.</span></div>
      {account.characters.length === 0 && <p className="formError">Esta conta não possui personagens para receber o item.</p>}
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="modalActions"><button type="button" className="ghostButton" disabled={pending} onClick={onClose}>Cancelar</button><button className="primaryButton compact" disabled={pending || !selected || !firstCharacter}>{pending ? "Registrando..." : "Enviar pelo correio"}</button></div>
    </form>
  </dialog>;
}

export function VipGroupMailEditor({ initialLevel, onClose, onSaved }: {
  initialLevel: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [vipLevel, setVipLevel] = useState(initialLevel);
  const [preview, setPreview] = useState<{ total: number; eligible: number; fullMailboxes: number } | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ItemCatalogEntry[]>([]);
  const [selected, setSelected] = useState<ItemCatalogEntry | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("Obrigado por apoiar o Dbo World!");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const batchKey = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/vip-mail?level=${vipLevel}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Falha ao contar destinatários."); setPreview(body);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [vipLevel]);
  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/items?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as ItemCatalogResponse | { error?: string };
        if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao buscar itens.");
        setResults((body as ItemCatalogResponse).items.filter(item => item.valid).slice(0, 8));
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao buscar itens."); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);
  function resetBatch() { batchKey.current = crypto.randomUUID(); }
  function choose(item: ItemCatalogEntry) { setSelected(item); setQuantity(1); setSearch(item.name); setResults([]); setError(""); resetBatch(); }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!selected || !preview?.eligible || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/vip-mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchKey: batchKey.current, vipLevel, itemTblidx: selected.tblidx, quantity, message }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Falha ao registrar lote."); onSaved(body.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); setPending(false); }
  }
  const maxQuantity = Math.max(1, selected?.maxStack ?? 1);
  return <dialog ref={dialog} className="editorModal vipDialog mailEditorDialog" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="group-mail-title">
    <div className="modalHeader"><div><div className="eyebrow">CORREIO EM GRUPO</div><h2 id="group-mail-title">Enviar para um nível VIP</h2><p>Um ovo negociável para o primeiro personagem de cada conta</p></div><button className="closeButton" onClick={onClose} disabled={pending} aria-label="Fechar">×</button></div>
    <form onSubmit={send}>
      <label className="mailField">Grupo<select value={vipLevel} onChange={event => { setPreview(null); setVipLevel(Number(event.target.value)); resetBatch(); }}><option value={1}>Todos do VIP 1</option><option value={2}>Todos do VIP 2</option><option value={3}>Todos do VIP 3</option></select></label>
      <div className="groupMailPreview"><div><small>CONTAS COM PERSONAGEM</small><strong>{preview?.total ?? "—"}</strong></div><div><small>RECEBERÃO</small><strong>{preview?.eligible ?? "—"}</strong></div><div><small>CAIXA CHEIA</small><strong>{preview?.fullMailboxes ?? "—"}</strong></div></div>
      <label className="mailField mailItemSearch">Item do catálogo<input value={search} onChange={event => { setSearch(event.target.value); setSelected(null); setResults([]); }} placeholder="Digite o nome ou TBLIDX" maxLength={80} autoComplete="off" required />
        {results.length > 0 && <div className="mailSearchResults">{results.map(item => <button type="button" key={item.tblidx} onClick={() => choose(item)}><span><strong>{item.name}</strong><small>TBLIDX {item.tblidx} · Rank {item.rank}</small></span><em>Máx. {Math.max(1, item.maxStack)}</em></button>)}</div>}
      </label>
      {selected && <div className="selectedMailItem"><span>✓</span><div><strong>{selected.name}</strong><small>TBLIDX {selected.tblidx} · Pilha máxima {maxQuantity}</small></div></div>}
      <div className="formGrid mailFormGrid"><label>Quantidade por conta<input type="number" min={1} max={maxQuantity} value={quantity} onChange={event => { setQuantity(Number(event.target.value)); resetBatch(); }} required /></label><label>Remetente<input value="DBO Admin" disabled /></label></div>
      <label className="mailField">Mensagem<textarea value={message} onChange={event => { setMessage(event.target.value); resetBatch(); }} maxLength={120} rows={3} required /><small>{message.length}/120 caracteres</small></label>
      <div className="groupMailWarning"><strong>Confirme o alcance do lote</strong><span>Serão criados {preview?.eligible ?? 0} ovos negociáveis, um para o primeiro personagem de cada conta VIP {vipLevel}.</span></div>
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="modalActions"><button type="button" className="ghostButton" disabled={pending} onClick={onClose}>Cancelar</button><button className="primaryButton compact" disabled={pending || !selected || !preview?.eligible}>{pending ? "Registrando lote..." : `Enviar para ${preview?.eligible ?? 0} contas`}</button></div>
    </form>
  </dialog>;
}
