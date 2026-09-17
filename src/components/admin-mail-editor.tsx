"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccountSummary, ItemCatalogEntry, ItemCatalogResponse } from "@/lib/types";
import { MailPackagePicker } from "@/components/mail-package-picker";

type Channel = "cashshop" | "mail";
type Recipient = { accountId: number; username: string; selectedCharId: number | null; characters: { charId: number; name: string; level: number; availableSlots: number; mailboxFull: boolean }[] };

export function AdminMailEditor({ account, onClose, onSaved }: {
  account: AccountSummary;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<Channel>("cashshop");
  const [packageId, setPackageId] = useState("");
  const [charId, setCharId] = useState(account.characters[0]?.charId ?? 0);
  const [message, setMessage] = useState("Presente enviado pela administração.");
  const [sealItem, setSealItem] = useState(false);
  const [results, setResults] = useState<ItemCatalogEntry[]>([]);
  const [selected, setSelected] = useState<ItemCatalogEntry | null>(null);
  const [quantity, setQuantity] = useState(1);
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
        const response = await fetch(`/api/items?search=${encodeURIComponent(search.trim())}&page=1${channel === "cashshop" ? "&cashShop=1" : ""}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as ItemCatalogResponse | { error?: string };
        if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao buscar itens.");
        setResults((body as ItemCatalogResponse).items.filter(item => item.valid).slice(0, 8));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao buscar itens.");
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, channel]);

  function choose(item: ItemCatalogEntry) {
    setSelected(item); setQuantity(1); setSearch(item.name); setResults([]); setError("");
    requestKey.current = crypto.randomUUID();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if ((!selected && !(channel === "mail" && packageId)) || pending || (channel === "mail" && !charId)) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/accounts/${account.accountId}/mail`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: requestKey.current, channel, ...(channel === "mail" && packageId ? { packageId } : { itemTblidx: selected?.tblidx, quantity }), ...(channel === "mail" ? { charId, message, sealItem } : {}) }),
      });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error ?? "Falha ao registrar envio.");
      onSaved(body.message ?? "Envio registrado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); setPending(false); }
  }

  const maxQuantity = Math.max(1, selected?.maxStack ?? 1);
  return <dialog ref={dialog} className="editorModal vipDialog mailEditorDialog" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="mail-editor-title">
    <div className="modalHeader"><div><div className="eyebrow">ENTREGA DE ITEM</div><h2 id="mail-editor-title">Enviar item</h2><p>{account.username} · Conta #{account.accountId} · VIP {account.vip}</p></div><button className="closeButton" onClick={onClose} disabled={pending} aria-label="Fechar">×</button></div>
    <form onSubmit={send}>
      <div className="mailChannelSwitch"><button type="button" className={channel === "cashshop" ? "active" : ""} onClick={() => { setChannel("cashshop"); setSearch(""); setSelected(null); requestKey.current = crypto.randomUUID(); }}>Cash Shop<small>Todos os personagens</small></button><button type="button" className={channel === "mail" ? "active" : ""} onClick={() => { setChannel("mail"); setSearch(""); setSelected(null); requestKey.current = crypto.randomUUID(); }}>Correio<small>Personagem escolhido · item selado</small></button></div>
      {channel === "mail" && <MailPackagePicker selectedId={packageId} onSelect={id => { setPackageId(id); setSelected(null); setSearch(""); requestKey.current = crypto.randomUUID(); }} />}
      {!(channel === "mail" && packageId) && <><label className="mailField mailItemSearch">Item do catálogo<input value={search} onChange={event => { setSearch(event.target.value); setSelected(null); setResults([]); }} placeholder="Digite o nome ou TBLIDX" maxLength={80} autoComplete="off" required />{searching && <span className="mailSearchStatus">Buscando...</span>}
        {results.length > 0 && <div className="mailSearchResults">{results.map(item => <button type="button" key={item.tblidx} onClick={() => choose(item)}><span><strong>{item.name}</strong><small>TBLIDX {item.tblidx} · Rank {item.rank}</small></span><em>Máx. {Math.max(1, item.maxStack)}</em></button>)}</div>}
      </label>
      {selected && <div className="selectedMailItem"><span>✓</span><div><strong>{selected.name}</strong><small>TBLIDX {selected.tblidx} · Pilha máxima {maxQuantity}</small></div></div>}
      <div className="formGrid mailFormGrid"><label>Quantidade<input type="number" min={1} max={maxQuantity} value={quantity} onChange={event => { setQuantity(Number(event.target.value)); requestKey.current = crypto.randomUUID(); }} required /></label><label>Remetente<input value="DBO Admin" disabled /></label></div></>}
      {channel === "mail" ? <div className="mailDestinationPanel"><label className="mailField">Personagem<select value={charId} onChange={event => { setCharId(Number(event.target.value)); requestKey.current = crypto.randomUUID(); }} required><option value={0} disabled>Selecione um personagem</option>{account.characters.map(character => <option key={character.charId} value={character.charId}>{character.name} · #{character.charId}</option>)}</select></label><label className="mailField">Mensagem<textarea value={message} onChange={event => { setMessage(event.target.value); requestKey.current = crypto.randomUUID(); }} maxLength={120} rows={3} required /></label><label className="mailSealOption"><input type="checkbox" checked={sealItem} onChange={event => { setSealItem(event.target.checked); requestKey.current = crypto.randomUUID(); }} /><span><strong>Enviar selado</strong><small>O item vira um ovo no inventário até o jogador retirar o selo. Desmarcado, chega com aparência normal.</small></span></label></div> : <div className="readonlyNotice"><strong>Caixa do Cash Shop</strong><span>O jogador poderá retirar o produto usando qualquer personagem da conta.</span></div>}
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="modalActions"><button type="button" className="ghostButton" disabled={pending} onClick={onClose}>Cancelar</button><button className="primaryButton compact" disabled={pending || (!selected && !(channel === "mail" && packageId)) || (channel === "mail" && !charId)}>{pending ? "Registrando..." : packageId && channel === "mail" ? "Enviar pacote pelo correio" : `Enviar pelo ${channel === "mail" ? "correio" : "Cash Shop"}`}</button></div>
    </form>
  </dialog>;
}

export function VipGroupMailEditor({ initialLevel, onClose, onSaved }: {
  initialLevel: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [vipLevel, setVipLevel] = useState(initialLevel);
  const [channel, setChannel] = useState<Channel>("cashshop");
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [packageId, setPackageId] = useState("");
  const [packageItemCount, setPackageItemCount] = useState(1);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [recipientSearch, setRecipientSearch] = useState("");
  const [message, setMessage] = useState("Presente VIP enviado pela administração.");
  const [sealItem, setSealItem] = useState(false);
  const [preview, setPreview] = useState<{ total: number; eligible: number; fullMailboxes: number } | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ItemCatalogEntry[]>([]);
  const [selected, setSelected] = useState<ItemCatalogEntry | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const batchKey = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/vip-mail?level=${vipLevel}&channel=${channel}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Falha ao contar destinatários.");
      if (channel === "mail") { const rows = body.recipients as Recipient[]; setRecipients(rows); setChoices(Object.fromEntries(rows.map(row => [row.accountId, row.selectedCharId ?? 0]))); }
      else setPreview(body);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [vipLevel, channel]);
  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/items?search=${encodeURIComponent(search.trim())}&page=1${channel === "cashshop" ? "&cashShop=1" : ""}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as ItemCatalogResponse | { error?: string };
        if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao buscar itens.");
        setResults((body as ItemCatalogResponse).items.filter(item => item.valid).slice(0, 8));
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao buscar itens."); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, channel]);
  function resetBatch() { batchKey.current = crypto.randomUUID(); }
  function choose(item: ItemCatalogEntry) { setSelected(item); setQuantity(1); setSearch(item.name); setResults([]); setError(""); resetBatch(); }
  const selectedRecipients = (recipients ?? []).flatMap(row => {
    const charId = choices[row.accountId];
    const character = row.characters.find(choice => choice.charId === charId);
    return character && character.availableSlots >= (packageId && channel === "mail" ? packageItemCount : 1) ? [{ accountId: row.accountId, charId }] : [];
  });
  const willReceive = channel === "mail" ? selectedRecipients.length : preview?.eligible ?? 0;
  async function send(event: FormEvent) {
    event.preventDefault(); if ((!selected && !(channel === "mail" && packageId)) || !willReceive || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/vip-mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchKey: batchKey.current, vipLevel, channel, ...(channel === "mail" && packageId ? { packageId } : { itemTblidx: selected?.tblidx, quantity }), ...(channel === "mail" ? { message, recipients: selectedRecipients, sealItem } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Falha ao registrar lote."); onSaved(body.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); setPending(false); }
  }
  const maxQuantity = Math.max(1, selected?.maxStack ?? 1);
  return <dialog ref={dialog} className="editorModal vipDialog mailEditorDialog" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="group-mail-title">
    <div className="modalHeader"><div><div className="eyebrow">ENTREGA VIP EM GRUPO</div><h2 id="group-mail-title">Enviar para um nível VIP</h2><p>Escolha o canal e confira os destinatários.</p></div><button className="closeButton" onClick={onClose} disabled={pending} aria-label="Fechar">×</button></div>
    <form onSubmit={send}>
      <div className="mailChannelSwitch"><button type="button" className={channel === "cashshop" ? "active" : ""} onClick={() => { setChannel("cashshop"); setSearch(""); setSelected(null); setPreview(null); resetBatch(); }}>Cash Shop<small>Todos os personagens</small></button><button type="button" className={channel === "mail" ? "active" : ""} onClick={() => { setChannel("mail"); setSearch(""); setSelected(null); setRecipients(null); resetBatch(); }}>Correio<small>Personagem escolhido · item selado</small></button></div>
      <label className="mailField">Grupo<select value={vipLevel} onChange={event => { setPreview(null); setRecipients(null); setVipLevel(Number(event.target.value)); resetBatch(); }}><option value={1}>Todos do VIP 1</option><option value={2}>Todos do VIP 2</option><option value={3}>Todos do VIP 3</option></select></label>
      <div className="groupMailPreview"><div><small>CONTAS VIP</small><strong>{channel === "mail" ? recipients?.length ?? "—" : preview?.total ?? "—"}</strong></div><div><small>RECEBERÃO</small><strong>{willReceive}</strong></div><div><small>DESTINO</small><strong>{channel === "mail" ? "Correio" : "Cash Shop"}</strong></div></div>
      {channel === "mail" && <MailPackagePicker selectedId={packageId} onSelect={(id, itemCount) => { setPackageId(id); setPackageItemCount(itemCount); setSelected(null); setSearch(""); resetBatch(); }} />}
      {!(channel === "mail" && packageId) && <><label className="mailField mailItemSearch">Item do catálogo<input value={search} onChange={event => { setSearch(event.target.value); setSelected(null); setResults([]); }} placeholder="Digite o nome ou TBLIDX" maxLength={80} autoComplete="off" required />
        {results.length > 0 && <div className="mailSearchResults">{results.map(item => <button type="button" key={item.tblidx} onClick={() => choose(item)}><span><strong>{item.name}</strong><small>TBLIDX {item.tblidx} · Rank {item.rank}</small></span><em>Máx. {Math.max(1, item.maxStack)}</em></button>)}</div>}
      </label>
      {selected && <div className="selectedMailItem"><span>✓</span><div><strong>{selected.name}</strong><small>TBLIDX {selected.tblidx} · Pilha máxima {maxQuantity}</small></div></div>}
      <div className="formGrid mailFormGrid"><label>Quantidade por conta<input type="number" min={1} max={maxQuantity} value={quantity} onChange={event => { setQuantity(Number(event.target.value)); resetBatch(); }} required /></label><label>Remetente<input value="DBO Admin" disabled /></label></div></>}
      {channel === "mail" && <><label className="mailField">Mensagem<textarea value={message} onChange={event => { setMessage(event.target.value); resetBatch(); }} maxLength={120} rows={3} required /></label><label className="mailSealOption"><input type="checkbox" checked={sealItem} onChange={event => { setSealItem(event.target.checked); resetBatch(); }} /><span><strong>Enviar selado</strong><small>O item vira ovo no inventário até retirar o selo. Desmarcado, chega com aparência normal.</small></span></label><section className="mailRecipientsSection"><div className="mailRecipientsHeader"><div><strong>Personagens destinatários</strong><small>Escolhas de envios anteriores aparecem pré-selecionadas. Correios cheios são ignorados.</small></div><input value={recipientSearch} onChange={event => setRecipientSearch(event.target.value)} placeholder="Filtrar conta ou ID" aria-label="Filtrar destinatários" /></div><div className="mailRecipientsList">{recipients === null ? <p>Carregando destinatários...</p> : recipients.filter(row => `${row.username} ${row.accountId}`.toLowerCase().includes(recipientSearch.toLowerCase())).map(row => <div className="mailRecipientRow" key={row.accountId}><div><strong>{row.username}</strong><small>Conta #{row.accountId} · {row.characters.length} personagens</small></div><select aria-label={`Personagem de ${row.username}`} value={choices[row.accountId] ?? 0} onChange={event => { setChoices(current => ({ ...current, [row.accountId]: Number(event.target.value) })); resetBatch(); }} disabled={!row.characters.length}><option value={0}>Não enviar</option>{row.characters.map(character => <option key={character.charId} value={character.charId} disabled={character.availableSlots < (packageId ? packageItemCount : 1)}>{character.name} · Nível {character.level} · #{character.charId}{character.availableSlots < (packageId ? packageItemCount : 1) ? " · Sem vagas suficientes" : ` · ${character.availableSlots} vagas`}</option>)}</select><span>{!row.characters.length ? "Sem personagem" : !choices[row.accountId] ? "Ignorado" : (row.characters.find(character => character.charId === choices[row.accountId])?.availableSlots ?? 0) < (packageId ? packageItemCount : 1) ? "Sem vagas" : `Nível ${row.characters.find(character => character.charId === choices[row.accountId])?.level ?? "—"}`}</span></div>)}</div><small>{selectedRecipients.length} de {recipients?.length ?? 0} contas receberão pelo correio.</small></section></>}
      <div className="groupMailWarning"><strong>Confirme o alcance do lote</strong><span>Serão criados {willReceive * (channel === "mail" && packageId ? packageItemCount : 1)} envios para {willReceive} contas VIP {vipLevel}, via {channel === "mail" ? "correio" : "Cash Shop"}.</span></div>
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="modalActions"><button type="button" className="ghostButton" disabled={pending} onClick={onClose}>Cancelar</button><button className="primaryButton compact" disabled={pending || (!selected && !(channel === "mail" && packageId)) || !willReceive}>{pending ? "Registrando lote..." : `Enviar ${packageId && channel === "mail" ? "pacote " : ""}para ${willReceive} contas`}</button></div>
    </form>
  </dialog>;
}
