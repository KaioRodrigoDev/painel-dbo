"use client";

import { useEffect, useState } from "react";
import type { ItemCatalogEntry, ItemCatalogResponse } from "@/lib/types";

type PackageItem = { itemTblidx: number; quantity: number; name: string };
type MailPackage = { id: string; name: string; items: PackageItem[]; updatedAt: string };

export function MailPackagePicker({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string, itemCount: number) => void }) {
  const [packages, setPackages] = useState<MailPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<PackageItem[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ItemCatalogEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/mail-packages", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json() as { packages?: MailPackage[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Falha ao carregar pacotes.");
      setPackages(body.packages ?? []);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao carregar pacotes."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!editing || search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/items?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as ItemCatalogResponse | { error?: string };
        if (!response.ok) throw new Error("error" in body ? body.error : "Falha ao buscar itens.");
        setResults((body as ItemCatalogResponse).items.filter(item => item.valid).slice(0, 10));
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao buscar itens."); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [editing, search]);
  const selected = packages.find(pkg => pkg.id === selectedId);
  function startNew() { setEditing(true); setEditingId(null); setName(""); setItems([]); setSearch(""); setResults([]); setError(""); }
  function startEdit() { if (!selected) return; setEditing(true); setEditingId(selected.id); setName(selected.name); setItems(selected.items); setSearch(""); setResults([]); setError(""); }
  function add(item: ItemCatalogEntry) {
    if (items.some(entry => entry.itemTblidx === item.tblidx)) { setError("Este item já está no pacote."); return; }
    if (items.length >= 20) { setError("O pacote aceita no máximo 20 itens."); return; }
    setItems(current => [...current, { itemTblidx: item.tblidx, quantity: 1, name: item.name }]);
    setSearch(""); setResults([]); setError("");
  }
  async function save() {
    if (!name.trim() || !items.length || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/mail-packages", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), name: name.trim(), items: items.map(({ itemTblidx, quantity }) => ({ itemTblidx, quantity })) }) });
      const body = await response.json() as { package?: MailPackage; error?: string };
      if (!response.ok || !body.package) throw new Error(body.error ?? "Falha ao salvar pacote.");
      setPackages(current => [...current.filter(pkg => pkg.id !== body.package!.id), body.package!].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      onSelect(body.package.id, body.package.items.length); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); }
    finally { setPending(false); }
  }
  async function remove() {
    if (!selected || pending || !window.confirm(`Excluir o pacote ${selected.name}?`)) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/mail-packages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Falha ao excluir pacote.");
      setPackages(current => current.filter(pkg => pkg.id !== selected.id)); onSelect("", 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); }
    finally { setPending(false); }
  }
  return <section className="mailPackagePanel" aria-label="Pacotes de correio">
    <div className="mailPackageHeader"><div><strong>Pacote de itens</strong><small>Salvo em arquivo no servidor. Cada item gera um correio separado.</small></div><button type="button" className="secondaryButton" onClick={startNew}>+ Criar pacote</button></div>
    <select aria-label="Pacote para enviar" value={selectedId} onChange={event => { const id = event.target.value; onSelect(id, packages.find(pkg => pkg.id === id)?.items.length ?? 1); }} disabled={loading || editing}><option value="">Enviar um item individual</option>{packages.map(pkg => <option key={pkg.id} value={pkg.id}>{pkg.name} · {pkg.items.length} itens</option>)}</select>
    {selected && !editing && <div className="mailPackageSummary"><div className="mailPackageItems">{selected.items.map(entry => <div key={entry.itemTblidx}><strong>{entry.name}</strong><small>TBLIDX {entry.itemTblidx} · Quantidade {entry.quantity}</small></div>)}</div><div className="mailPackageActions"><button type="button" className="secondaryButton" onClick={startEdit}>Editar</button><button type="button" className="ghostButton" onClick={remove} disabled={pending}>Excluir</button></div></div>}
    {editing && <div className="mailPackageComposer"><div className="mailPackageComposerTitle"><strong>{editingId ? "Editar pacote" : "Novo pacote"}</strong><button type="button" className="ghostButton" onClick={() => setEditing(false)} disabled={pending}>Fechar</button></div><label className="mailField">Nome do pacote<input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="Ex.: Kit VIP 1" /></label><label className="mailField mailItemSearch">Adicionar item<input value={search} onChange={event => { setSearch(event.target.value); setResults([]); }} placeholder="Nome ou TBLIDX" maxLength={80} autoComplete="off" />{results.length > 0 && <div className="mailSearchResults">{results.map(item => <button type="button" key={item.tblidx} onClick={() => add(item)}><span><strong>{item.name}</strong><small>TBLIDX {item.tblidx} · Máx. {Math.max(1, item.maxStack)}</small></span></button>)}</div>}</label><div className="mailPackageItems">{items.map((entry, index) => <div key={entry.itemTblidx}><div><strong>{entry.name}</strong><small>TBLIDX {entry.itemTblidx}</small></div><label>Quantidade<input type="number" min={1} max={254} value={entry.quantity} onChange={event => setItems(current => current.map((item, position) => position === index ? { ...item, quantity: Number(event.target.value) } : item))} /></label><button type="button" className="ghostButton" onClick={() => setItems(current => current.filter(item => item.itemTblidx !== entry.itemTblidx))}>Remover</button></div>)}</div><button type="button" className="primaryButton compact" onClick={save} disabled={pending || !name.trim() || !items.length}>{pending ? "Salvando..." : "Salvar pacote"}</button></div>}
    {error && <p className="formError" role="alert">{error}</p>}
  </section>;
}
