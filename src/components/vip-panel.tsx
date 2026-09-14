"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { vipExpiry, vipStatus, type VipChange } from "@/lib/vip-rules";

export type VipAccount = { accountId: number; username: string; vip: number; vipExpiresAt: string | null };
export const vipLabels: Record<string, string> = {
  none: "Sem VIP", active: "Ativo", legacy: "Sem validade cadastrada", expired: "Vencido · aguardando processamento", expiring: "Vence em até 7 dias", invalid: "Nível inválido",
};
export function vipDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Sem validade cadastrada";
}
export function VipBadge({ account }: { account: VipAccount }) {
  const status = vipStatus(account.vip, account.vipExpiresAt);
  return <span className={`vipBadge vip-${status}`}>{account.vip === 0 ? "Sem VIP" : `VIP ${account.vip} · ${vipLabels[status]}`}</span>;
}

export function VipEditor({ account, renew, onClose, onSaved }: { account: VipAccount; renew: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [previewNow] = useState(() => new Date());
  const [level, setLevel] = useState(renew && account.vip === 0 ? 1 : account.vip);
  const [duration, setDuration] = useState<VipChange["duration"]>(!renew && account.vipExpiresAt && Date.parse(account.vipExpiresAt) > previewNow.getTime() ? "keep" : "30");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const change: VipChange = { requestId: "", operation: renew ? "renew" : "edit", level, duration, ...(duration === "date" ? { date } : {}) };
  let preview = "Sem VIP";
  let valid = true;
  try { const expiry = vipExpiry(change, account.vipExpiresAt, previewNow); if (expiry) preview = vipDate(expiry); }
  catch (cause) { valid = false; preview = cause instanceof Error ? cause.message : "Selecione a validade."; }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    const fingerprint = JSON.stringify(change);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/accounts/${account.accountId}/vip`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...change, requestId: request.current.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar VIP.");
      onSaved(body.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão. Tente novamente."); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className="editorModal vipDialog" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="vip-title">
    <div className="modalHeader"><div><div className="eyebrow">{renew ? "RENOVAR VIP" : "GERENCIAR VIP"}</div><h2 id="vip-title">{account.username}</h2><p>Conta #{account.accountId} · VIP atual: {account.vip}</p></div><button className="closeButton" onClick={onClose} disabled={pending} aria-label="Fechar">×</button></div>
    <form onSubmit={save}>
      <fieldset disabled={pending} className="vipFieldset"><div className="formGrid">
        <label>Nível<select value={level} onChange={event => setLevel(Number(event.target.value))}>{!renew && <option value={0}>0 · Sem VIP</option>}{[1, 2, 3].map(value => <option key={value} value={value}>VIP {value}</option>)}</select></label>
        {level > 0 && <label>Validade<select value={duration} onChange={event => setDuration(event.target.value as VipChange["duration"])}>
          {!renew && account.vipExpiresAt && Date.parse(account.vipExpiresAt) > previewNow.getTime() && <option value="keep">Manter validade atual</option>}
          <option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="date">Data personalizada</option>
        </select></label>}
        {level > 0 && duration === "date" && <label>Último dia de VIP<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>}
      </div></fieldset>
      <div className="readonlyNotice"><strong>Validade atual: {account.vip === 0 ? "Sem VIP" : vipDate(account.vipExpiresAt)}</strong><span>Nova validade: {preview} (horário de São Paulo).</span><span>{renew ? "Os dias restantes são preservados na renovação por período." : "Alterar somente o nível permite manter a validade atual."} O prazo final é calculado ao salvar.</span></div>
      <p className="muted">O jogo pode manter o nível anterior em sessões abertas até recarregar a conta.</p>
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="modalActions"><button type="button" className="ghostButton" disabled={pending} onClick={onClose}>Cancelar</button><button className="primaryButton compact" disabled={pending || !valid}>{pending ? "Salvando..." : renew ? "Confirmar renovação" : "Salvar VIP"}</button></div>
    </form>
  </dialog>;
}

type Overview = {
  totals: Record<string, number>;
  upcoming: { accountId: number; username: string; vip: number; expiresAt: string }[];
  lastRun: { startedAt: string; finishedAt: string | null; status: string; processed: number; error: string | null } | null;
  updatedAt: string;
};
export function PlayersOverview({ onAccounts, onRenew, onBulkMail }: { onAccounts: (state?: string, level?: string) => void; onRenew: (account: VipAccount) => void; onBulkMail: (level: number) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao carregar dashboard.");
      setData(body); setError("");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [refresh]);
  const t = data?.totals;
  return <section className="contentPanel overviewPanel">
    <div className="overviewToolbar">
      <div><span className="overviewKicker">PAINEL EM TEMPO REAL</span><h2>Central de jogadores</h2><p>Contas, atividade e assinaturas em um só lugar.</p></div>
      <div className="overviewToolbarActions">{data && <span className="overviewUpdated"><i /> Atualizado {vipDate(data.updatedAt)}</span>}<button className="refreshButton" onClick={() => { setData(null); setError(""); setRefresh(value => value + 1); }}>↻ Atualizar</button></div>
    </div>
    {error && <div className="errorBanner" role="alert">{error}</div>}
    {!data && !error && <div className="overviewLoading"><span className="spinner" /><div><strong>Montando sua visão geral</strong><small>Consultando contas, jogadores e VIPs...</small></div></div>}
    {data && t && <>
      <div className="overviewStats">
        <button className="overviewStat overviewStatPrimary" onClick={() => onAccounts()}><span className="overviewStatIcon">◎</span><span className="overviewStatText"><small>CONTAS CADASTRADAS</small><strong>{t.totalAccounts.toLocaleString("pt-BR")}</strong><em>Ver todas as contas <b>→</b></em></span></button>
        <div className="overviewStat"><span className="overviewStatIcon blue">♟</span><span className="overviewStatText"><small>PERSONAGENS</small><strong>{t.totalCharacters.toLocaleString("pt-BR")}</strong><em><i className="onlinePulse" /> {t.onlineCharacters} online em {t.onlineAccounts} contas</em></span></div>
        <button className="overviewStat" onClick={() => onAccounts("current")}><span className="overviewStatIcon gold">★</span><span className="overviewStatText"><small>VIPs VIGENTES</small><strong>{t.activeVip + t.legacyVip}</strong><em>{t.activeVip} com validade definida <b>→</b></em></span></button>
        <button className={`overviewStat ${t.expiringVip > 0 ? "attention" : ""}`} onClick={() => onAccounts("expiring")}><span className="overviewStatIcon amber">◷</span><span className="overviewStatText"><small>VENCEM EM 7 DIAS</small><strong>{t.expiringVip}</strong><em>{t.expiringVip > 0 ? "Precisam de atenção" : "Tudo tranquilo"} <b>→</b></em></span></button>
      </div>

      <div className="overviewVipGrid">
        <article className="overviewSection vipDistribution">
          <header><div><span className="overviewSectionIcon">★</span><div><h3>Distribuição VIP</h3><p>Assinaturas ativas por nível</p></div></div><button onClick={() => onAccounts("current")}>Ver todos <span>→</span></button></header>
          <div className="vipTotal"><div><small>TOTAL VIGENTE</small><strong>{t.activeVip + t.legacyVip}</strong></div><span>{t.legacyVip > 0 ? `${t.legacyVip} sem validade` : "Todos com validade"}</span></div>
          <div className="vipLevelList">{[1, 2, 3].map(level => {
            const count = t[`vip${level}`];
            const percentage = t.activeVip ? Math.round((count / t.activeVip) * 100) : 0;
            return <button className={`vipLevelRow vipLevel${level}`} key={level} onClick={() => onAccounts("active", String(level))}>
              <span className="vipLevelMark">{level}</span><span className="vipLevelInfo"><span><b>VIP {level}</b><em>{count} {count === 1 ? "conta" : "contas"}</em></span><i><u style={{ width: `${percentage}%` }} /></i></span><strong>{percentage}%</strong>
            </button>;
          })}</div>
          <div className="vipBulkActions"><span>Enviar item para um grupo:</span>{[1, 2, 3].map(level => <button key={level} onClick={() => onBulkMail(level)}>✉ VIP {level}</button>)}</div>
        </article>

        <aside className="overviewSideStack">
          <button className={`vipSignal vipSignalWarning ${t.legacyVip === 0 ? "quiet" : ""}`} onClick={() => onAccounts("legacy")}><span>!</span><div><small>SEM VALIDADE</small><strong>{t.legacyVip}</strong><p>{t.legacyVip === 1 ? "VIP precisa" : "VIPs precisam"} de regularização</p></div><b>→</b></button>
          <button className={`vipSignal vipSignalDanger ${t.expiredVip === 0 ? "quiet" : ""}`} onClick={() => onAccounts("expired")}><span>×</span><div><small>VENCIDOS</small><strong>{t.expiredVip}</strong><p>Aguardando processamento</p></div><b>→</b></button>
          {t.invalidVip > 0 && <button className="vipSignal vipSignalDanger" onClick={() => onAccounts("invalid")}><span>?</span><div><small>NÍVEL INVÁLIDO</small><strong>{t.invalidVip}</strong><p>Contas precisam de revisão</p></div><b>→</b></button>}
        </aside>
      </div>

      <article className="overviewSection vipExpirySection">
        <header><div><span className="overviewSectionIcon clock">◷</span><div><h3>Próximos vencimentos</h3><p>VIPs ordenados pela data mais próxima</p></div></div><span className="expiryCount">{data.upcoming.length} exibidos</span></header>
        <div className="vipUpcoming">{data.upcoming.length ? data.upcoming.map(account => <article key={account.accountId}>
          <span className={`upcomingVipIcon level${account.vip}`}>V{account.vip}</span>
          <div className="upcomingIdentity"><strong>{account.username}</strong><small>Conta #{account.accountId}</small></div>
          <span className={`upcomingLevel level${account.vip}`}>VIP {account.vip}</span>
          <div className="upcomingDate"><small>VENCIMENTO</small><strong>{vipDate(account.expiresAt)}</strong></div>
          <button className="renewVipButton" onClick={() => onRenew({ ...account, vipExpiresAt: account.expiresAt })}>Renovar <span>→</span></button>
        </article>) : <div className="vipEmptyState"><span>✓</span><div><strong>Nenhum vencimento futuro</strong><p>Não há assinaturas VIP com prazo para exibir.</p></div></div>}</div>
      </article>

      <footer className={`vipJobStatus ${data.lastRun?.status ?? "unknown"}`}><span className="jobStatusIcon">{data.lastRun?.status === "success" ? "✓" : data.lastRun?.status === "running" ? "↻" : "!"}</span><div><strong>Rotina automática de expiração</strong><p>{data.lastRun ? `Última execução em ${vipDate(data.lastRun.startedAt)} · ${data.lastRun.processed} contas processadas` : "Nenhuma execução registrada"}</p>{data.lastRun?.error && <small role="alert">{data.lastRun.error}</small>}{data.lastRun && Date.parse(data.updatedAt) - Date.parse(data.lastRun.startedAt) > 26 * 3600000 && <small role="alert">A rotina está atrasada. Verifique o agendador.</small>}</div><span className="jobSchedule"><small>PRÓXIMA ROTINA</small><strong>Todos os dias · 00h05</strong><em>Horário de São Paulo</em></span></footer>
    </>}
  </section>;
}
