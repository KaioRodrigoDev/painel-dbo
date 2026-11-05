"use client";

import { useCallback, useEffect, useState } from "react";

// Tipos espelhados de @/lib/crash-reports (que é server-only).
type CrashStatus = "new" | "seen" | "fixed" | "ignored";
type CrashGroup = {
  signature: string; signatureText: string; exception: string; exitCode: string; total: number; recent: number;
  accounts: number; firstAt: string; lastAt: string; status: CrashStatus; versions: string[];
};
type CrashOverview = { installed: boolean; counts: { today: number; week: number; open: number; accountsWeek: number }; groups: CrashGroup[] };
type CrashSummary = {
  id: number; createdAt: string; username: string | null; accountId: number | null; launcherVersion: string; gameVersion: string;
  architecture: string; graphics: string; playSeconds: number; status: CrashStatus;
};
type CrashDetail = CrashSummary & {
  occurredAt: string | null; ip: string | null; windows: string; exitCode: string; exception: string; signature: string;
  signatureText: string; report: string; log: string; dxLog: string;
};

const STATUS_LABEL: Record<CrashStatus, string> = { new: "Novo", seen: "Visto", fixed: "Corrigido", ignored: "Ignorado" };

// Códigos de saída mais comuns do Windows, para quem lê não precisar procurar.
const EXIT_CODES: Record<string, string> = {
  C0000005: "Acesso inválido à memória",
  C00000FD: "Estouro de pilha",
  C0000409: "Estouro de buffer detectado",
  C0000374: "Memória corrompida (heap)",
  C000001D: "Instrução inválida",
  C0000094: "Divisão por zero",
  C0000017: "Sem memória",
  "80000003": "Breakpoint",
  E06D7363: "Exceção C++ não tratada",
};

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Falha na consulta.");
  return body as T;
}

export function CrashReportPanel() {
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState("open");
  const [data, setData] = useState<CrashOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [crashes, setCrashes] = useState<CrashSummary[] | null>(null);
  const [detail, setDetail] = useState<CrashDetail | null>(null);
  const [tab, setTab] = useState<"report" | "log" | "dxLog">("report");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try { setData(await getJson<CrashOverview>(`/api/crash-reports?days=${days}&status=${status}`, { signal })); }
    catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [days, status]);

  useEffect(() => {
    const controller = new AbortController();
    const request = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(request); controller.abort(); };
  }, [load]);

  async function toggle(group: CrashGroup) {
    if (open === group.signature) { setOpen(null); setCrashes(null); setDetail(null); return; }
    setOpen(group.signature); setCrashes(null); setDetail(null);
    try {
      const body = await getJson<{ crashes: CrashSummary[] }>(`/api/crash-reports/group?signature=${group.signature}`);
      setCrashes(body.crashes);
      if (body.crashes[0]) void show(body.crashes[0].id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao abrir o grupo."); }
  }

  async function show(id: number) {
    try { setDetail(await getJson<CrashDetail>(`/api/crash-reports/${id}`)); setTab("report"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao abrir o relatório."); }
  }

  async function mark(signature: string, next: CrashStatus) {
    setSaving(true);
    try {
      await getJson(`/api/crash-reports/group`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature, status: next }) });
      await load();
      setCrashes(current => current?.map(crash => ({ ...crash, status: next })) ?? null);
      setDetail(current => (current ? { ...current, status: next } : current));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar."); }
    finally { setSaving(false); }
  }

  const text = detail ? (tab === "report" ? detail.report : tab === "log" ? detail.log : detail.dxLog) : "";

  return <div className="deliveryHistory crashPanel">
    <div className="crashToolbar">
      <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Estado">
        <option value="open">Abertos (novos e vistos)</option><option value="new">Só novos</option><option value="fixed">Corrigidos</option>
        <option value="ignored">Ignorados</option><option value="all">Todos</option>
      </select>
      <select value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Período">
        <option value={1}>Últimas 24 h</option><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={180}>Últimos 180 dias</option>
      </select>
      <button className="refreshButton" type="button" onClick={() => void load()} disabled={loading}>↻ Atualizar</button>
    </div>

    {data?.installed === false && <div className="errorBanner"><strong>Tabela ainda não criada</strong><span>Rode mdbo-launcher/server/sql/005_crash_reports.sql no banco de contas (mdbo_acc). Até lá, a API recusa os relatórios.</span></div>}
    {data?.installed && <div className="deliveryStats">
      <article><small>HOJE</small><strong>{data.counts.today}</strong></article>
      <article><small>ÚLTIMOS 7 DIAS</small><strong>{data.counts.week}</strong></article>
      <article className="failed"><small>SEM OLHAR</small><strong>{data.counts.open}</strong></article>
      <article><small>JOGADORES AFETADOS (7 DIAS)</small><strong>{data.counts.accountsWeek}</strong></article>
    </div>}
    {error && <div className="errorBanner"><strong>Falha na consulta</strong><span>{error}</span></div>}
    {loading && !data && <div className="loadingState"><span className="spinner" /> Consultando erros do jogo...</div>}
    {data?.installed && data.groups.length === 0 && !loading && <div className="emptyState">Nenhum crash neste período. 🎉</div>}

    {data && data.groups.length > 0 && <div className="crashGroups">
      {data.groups.map(group => {
        const expanded = open === group.signature;
        const [head, ...frames] = group.signatureText.split(" < ");
        return <article key={group.signature} className={`crashGroup ${expanded ? "open" : ""}`}>
          <button type="button" className="crashGroupHead" onClick={() => void toggle(group)} aria-expanded={expanded}>
            <span className={`deliveryStatus crashStatus ${group.status}`}>{STATUS_LABEL[group.status]}</span>
            <span className="crashSignature">
              <strong>{group.exception || EXIT_CODES[group.exitCode] || head}</strong>
              <small>{frames.length > 0 ? frames.join(" ← ") : `Código ${group.exitCode}${EXIT_CODES[group.exitCode] ? ` · ${EXIT_CODES[group.exitCode]}` : ""} · sem Client.RPT`}</small>
            </span>
            <span className="crashNumbers"><strong>{group.total}×</strong><small>{group.accounts} {group.accounts === 1 ? "jogador" : "jogadores"}</small></span>
            <span className="crashNumbers"><strong>{date(group.lastAt)}</strong><small>{group.versions.length ? group.versions.join(", ") : "versão ?"}</small></span>
          </button>

          {expanded && <div className="crashBody">
            <div className="crashActions">
              <span>Marcar o grupo:</span>
              {(["seen", "fixed", "ignored", "new"] as CrashStatus[]).filter(next => next !== group.status).map(next =>
                <button key={next} type="button" className="ghostButton" disabled={saving} onClick={() => void mark(group.signature, next)}>{STATUS_LABEL[next]}</button>)}
              <small>Um crash novo com a mesma assinatura volta o grupo para Novo.</small>
            </div>
            <div className="crashSplit">
              <ul className="crashList">
                {!crashes && <li className="crashListEmpty"><span className="spinner" /></li>}
                {crashes?.map(crash => <li key={crash.id}>
                  <button type="button" className={detail?.id === crash.id ? "active" : ""} onClick={() => void show(crash.id)}>
                    <strong>#{crash.id} · {crash.username ?? "sem conta"}</strong>
                    <small>{date(crash.createdAt)} · jogou {duration(crash.playSeconds)}</small>
                    <small>{crash.architecture || "?"} · {crash.graphics || "?"} · launcher {crash.launcherVersion || "?"}</small>
                  </button>
                </li>)}
              </ul>
              {detail && <div className="crashDetail">
                <dl>
                  <div><dt>Conta</dt><dd>{detail.username ?? "—"}{detail.accountId ? ` (#${detail.accountId})` : " · não confirmada"}</dd></div>
                  <div><dt>Código</dt><dd>{detail.exitCode}{detail.exception ? ` ${detail.exception}` : ""}{EXIT_CODES[detail.exitCode] ? ` · ${EXIT_CODES[detail.exitCode]}` : ""}</dd></div>
                  <div><dt>Quando</dt><dd>{date(detail.createdAt)} · jogou {duration(detail.playSeconds)}</dd></div>
                  <div><dt>Versões</dt><dd>jogo {detail.gameVersion || "?"} · launcher {detail.launcherVersion || "?"}</dd></div>
                  <div><dt>Cliente</dt><dd>{detail.architecture || "?"} · {detail.graphics === "vulkan" ? "Vulkan (DXVK)" : detail.graphics === "directx" ? "DirectX 9" : "?"}</dd></div>
                  <div><dt>Windows</dt><dd>{detail.windows || "?"}</dd></div>
                </dl>
                <div className="crashTabs" role="tablist">
                  <button type="button" role="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}>Pilha (Client.RPT)</button>
                  <button type="button" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")}>dbolog.txt</button>
                  <button type="button" role="tab" aria-selected={tab === "dxLog"} onClick={() => setTab("dxLog")}>Placa (DxLog)</button>
                  <button type="button" className="crashCopy" disabled={!text} onClick={() => void navigator.clipboard?.writeText(text)}>Copiar</button>
                </div>
                <pre className="crashText">{text || (tab === "report" ? "O jogo fechou sem escrever o Client.RPT (crash antes do tratador de erros ou fechado à força)." : "Arquivo vazio ou não encontrado no PC do jogador.")}</pre>
              </div>}
            </div>
          </div>}
        </article>;
      })}
    </div>}
  </div>;
}
