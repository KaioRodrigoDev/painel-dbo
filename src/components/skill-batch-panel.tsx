"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { SkillBatchApplyResult, SkillBatchExportResult, SkillBatchItem, SkillBatchPreview } from "@/lib/types";

const formatBytes = (bytes: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;

function BatchSkillIcon({ iconName }: { iconName: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconName || failed) return <span className="itemIconPlaceholder">—</span>;
  return <span className="itemIconPlaceholder itemIconLoaded"><Image src={`/api/skills/icons/${encodeURIComponent(iconName)}`} alt="" width={40} height={40} unoptimized onError={() => setFailed(true)} /></span>;
}

/**
 * Lote de alterações de skill: tudo o que foi editado e ainda não foi aplicado, numa tela
 * só. Daqui sai o pacote para distribuir (relatório + arquivos) ou a aplicação direta no
 * servidor e no cliente local.
 */
export function SkillBatchPanel({ onBack, onEdit }: { onBack: () => void; onEdit: (tblidx: number) => void }) {
  const router = useRouter();
  const [batch, setBatch] = useState<SkillBatchPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "export" | "apply" | "discard">("");
  const [error, setError] = useState("");
  const [packDirectory, setPackDirectory] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [applyServer, setApplyServer] = useState(true);
  const [applyClient, setApplyClient] = useState(true);
  const [exported, setExported] = useState<SkillBatchExportResult | null>(null);
  const [applied, setApplied] = useState<SkillBatchApplyResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/skill-batch", { cache: "no-store" });
      if (response.status === 401) { router.push("/login"); return; }
      const body = (await response.json().catch(() => ({}))) as { batch?: SkillBatchPreview; error?: string };
      if (!response.ok || !body.batch) throw new Error(body.error ?? "Não foi possível montar o lote.");
      setBatch(body.batch);
      setPackDirectory((current) => current || body.batch!.defaultClientPackDirectory);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível montar o lote."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function post<T>(body: Record<string, unknown>) {
    const response = await fetch("/api/skill-batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401) { router.push("/login"); throw new Error("Sessão expirada."); }
    const parsed = (await response.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!response.ok || !parsed.result) throw new Error(parsed.error ?? "A ação do lote falhou.");
    return parsed.result;
  }

  async function exportBatch() {
    if (!batch?.token) return;
    setBusy("export"); setError(""); setApplied(null);
    try {
      const result = await post<SkillBatchExportResult>({ action: "export", token: batch.token, clientPackDirectory: packDirectory || null });
      setExported(result);
      // Dispara o download na hora; o link continua no aviso para baixar de novo.
      const link = document.createElement("a");
      link.href = `/api/skill-batch/export/${encodeURIComponent(result.exportId)}`;
      link.download = result.fileName;
      link.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível exportar."); }
    finally { setBusy(""); }
  }

  async function applyBatch() {
    if (!batch?.token) return;
    setBusy("apply"); setError(""); setExported(null);
    try {
      const result = await post<SkillBatchApplyResult>({ action: "apply", token: batch.token, server: applyServer, client: applyClient, clientPackDirectory: packDirectory || null });
      setApplied(result);
      setConfirming(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível aplicar."); setConfirming(false); }
    finally { setBusy(""); }
  }

  async function discard(target: SkillBatchItem | "all") {
    const pergunta = target === "all"
      ? "Descartar TODAS as alterações pendentes? Os rascunhos vão para a pasta de descartados e saem do lote."
      : `Descartar as alterações de ${target.name} (#${target.tblidx})?`;
    if (!window.confirm(pergunta)) return;
    setBusy("discard"); setError("");
    try {
      await post({ action: "discard", tblidxs: target === "all" ? "all" : [target.tblidx] });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível descartar."); }
    finally { setBusy(""); }
  }

  const items = batch?.items ?? [];
  const blocked = items.filter((item) => item.blockingIssues.length).length;

  return <div className="skillBatchPanel">
    <div className="draftCreatorHeader">
      <div>
        <div className="eyebrow">LOTE DE ALTERAÇÕES</div>
        <h2>Alterações pendentes de skills</h2>
        <p>Edite quantas skills quiser; aqui você revisa tudo junto e decide: exportar o pacote, aplicar ou descartar.</p>
      </div>
      <button className="catalogClearButton" type="button" onClick={onBack}>← Voltar ao catálogo</button>
    </div>

    {error && <div className="errorBanner"><strong>Não foi possível concluir</strong><span>{error}</span></div>}
    {exported && <div className="successBanner">
      <strong>Pacote exportado</strong>
      <span>{exported.skills} skill{exported.skills === 1 ? "" : "s"} e {exported.changes} campo{exported.changes === 1 ? "" : "s"} · {formatBytes(exported.size)}. O .zip traz o relatório de mudanças, o {exported.packFileName} do cliente e o Table_Skill_Data.rdf do servidor. Nada foi alterado no servidor nem no cliente.</span>
      <a className="packDownloadLink" href={`/api/skill-batch/export/${encodeURIComponent(exported.exportId)}`} download={exported.fileName}>Baixar {exported.fileName} de novo</a>
    </div>}
    {applied && <div className="successBanner">
      <strong>Lote aplicado</strong>
      <span>{applied.applied.length} skill{applied.applied.length === 1 ? "" : "s"}: {applied.applied.map((entry) => `${entry.name} #${entry.tblidx}`).join(", ")}.</span>
      {applied.server && <span>Servidor: {applied.server.rdfPath} · backup em {applied.server.backupPath}. Reinicie o GameServer para valer.</span>}
      {applied.client && <span>Cliente: {applied.client.packPath}{applied.client.backupPath ? ` · backup em ${applied.client.backupPath}` : ""}. Reabra o cliente para ver.</span>}
      {!applied.server && <span>O servidor não foi alterado, então as skills continuam no lote até serem aplicadas nele.</span>}
      {applied.skipped.length > 0 && <span>Ficaram de fora: {applied.skipped.map((entry) => `${entry.name} #${entry.tblidx}`).join(", ")}.</span>}
    </div>}

    {loading && !batch ? <div className="loadingState"><span className="spinner" /> Comparando os rascunhos com o RDF atual...</div>
      : !items.length ? <div className="draftEmptyState skillBatchEmpty">
          <div><strong>Nenhuma alteração pendente.</strong><span>Edite uma skill e salve: ela entra aqui automaticamente.</span></div>
        </div>
      : <>
        <div className="skillBatchStats">
          <div><small>Skills no lote</small><strong>{items.length}</strong></div>
          <div className="ready"><small>Prontas</small><strong>{batch?.readyCount ?? 0}</strong></div>
          <div><small>Campos alterados</small><strong>{batch?.changeCount ?? 0}</strong></div>
          <div className={blocked ? "warn" : ""}><small>Com pendência</small><strong>{blocked}</strong></div>
        </div>

        <div className="skillBatchLayout">
          <div className="skillBatchList">
            {items.map((item) => <article key={item.tblidx} className={`skillBatchItem${item.blockingIssues.length ? " blocked" : ""}`}>
              <header>
                <BatchSkillIcon iconName={item.iconName} />
                <div className="skillBatchItemTitle">
                  <strong>{item.name}</strong>
                  <span>#{item.tblidx} · {item.changes.length} campo{item.changes.length === 1 ? "" : "s"} · salvo por {item.administrator} em {new Date(item.updatedAt).toLocaleString("pt-BR")}
                    {item.supersededDraftIds.length > 0 && ` · ${item.supersededDraftIds.length} versão(ões) antiga(s) será(ão) descartada(s) junto`}</span>
                </div>
                <span className={`skillBatchStatus${item.blockingIssues.length ? " blocked" : ""}`}>{item.blockingIssues.length ? "Com pendência" : "Pronta"}</span>
                <div className="skillBatchItemActions">
                  <button type="button" className="catalogDetailsButton" onClick={() => onEdit(item.tblidx)}>Editar</button>
                  <button type="button" className="skillBatchDiscard" disabled={Boolean(busy)} onClick={() => void discard(item)}>Descartar</button>
                </div>
              </header>
              {item.blockingIssues.length > 0 && <div className="errorBanner subtle"><strong>Fica fora do lote até ser resolvido</strong>{item.blockingIssues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
              {item.changes.length > 0 && <table className="skillBatchChanges">
                <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
                <tbody>{item.changes.map((change) => <tr key={change.id}>
                  <td><strong>{change.label}</strong><small>{change.sourceField}</small></td>
                  <td className="before">{change.beforeText}</td>
                  <td className="after">{change.afterText}</td>
                </tr>)}</tbody>
              </table>}
            </article>)}
          </div>

          <aside className="skillBatchActions">
            <div className="eyebrow">CONCLUIR O LOTE</div>
            <h3>{batch?.readyCount ?? 0} skill{batch?.readyCount === 1 ? "" : "s"} pronta{batch?.readyCount === 1 ? "" : "s"}</h3>
            <label className="publishPackPath"><span>Pasta pack do cliente</span>
              <input type="text" value={packDirectory} onChange={(event) => setPackDirectory(event.target.value)} spellCheck={false} /></label>

            <button type="button" className="primaryButton" disabled={!batch?.token || Boolean(busy)} onClick={() => void exportBatch()}>
              {busy === "export" ? "Gerando pacote..." : "Exportar pacote (.zip)"}</button>
            <small>Relatório das mudanças por skill + o pack do cliente e o RDF do servidor já corrigidos. Não altera nada.</small>

            <button type="button" className="publishDraftButton" disabled={!batch?.token || Boolean(busy)} onClick={() => setConfirming(true)}>Aplicar no servidor e cliente…</button>
            <small>Grava direto nos arquivos desta máquina, com backup antes.</small>

            <button type="button" className="skillBatchDiscard wide" disabled={Boolean(busy)} onClick={() => void discard("all")}>Descartar tudo</button>
          </aside>
        </div>
      </>}

    {confirming && batch && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) setConfirming(false); }}>
      <section className="editorModal" role="dialog" aria-modal="true" aria-labelledby="batch-apply-title">
        <div className="modalHeader"><div><div className="eyebrow">CONFIRMAÇÃO</div><h2 id="batch-apply-title">Aplicar {batch.readyCount} skill{batch.readyCount === 1 ? "" : "s"}</h2><p>{batch.changeCount} campos de uma vez, com backup de cada arquivo antes.</p></div>
          <button className="closeButton" disabled={Boolean(busy)} onClick={() => setConfirming(false)} aria-label="Fechar">×</button></div>
        <div className="publishClientOptions">
          <strong>Onde aplicar</strong>
          <label><input type="checkbox" checked={applyServer} onChange={(event) => setApplyServer(event.target.checked)} /><span>Servidor — Table_Skill_Data.rdf (reinicie o GameServer depois)</span></label>
          <label><input type="checkbox" checked={applyClient} onChange={(event) => setApplyClient(event.target.checked)} /><span>Cliente desta máquina — {packDirectory || "pasta pack padrão"}</span></label>
          {!applyServer && applyClient && <small className="muted">Só no cliente: o servidor continua com o valor antigo, então as skills permanecem no lote.</small>}
        </div>
        {blocked > 0 && <div className="publishWarnings"><span>⚠ {blocked} skill{blocked === 1 ? "" : "s"} com pendência fica{blocked === 1 ? "" : "m"} de fora.</span></div>}
        <div className="modalActions">
          <button className="catalogClearButton" type="button" disabled={Boolean(busy)} onClick={() => setConfirming(false)}>Cancelar</button>
          <button className="dangerPublishButton" type="button" disabled={Boolean(busy) || (!applyServer && !applyClient)} onClick={() => void applyBatch()}>{busy === "apply" ? "Aplicando..." : "Confirmar e aplicar"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
