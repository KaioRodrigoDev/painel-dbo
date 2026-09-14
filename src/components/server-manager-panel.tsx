"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ManagedServer, ServerManagerSnapshot } from "@/lib/types";

function formatStartedAt(value: string | null) {
  if (!value) return "Horário indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function ServerManagerPanel() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ServerManagerSnapshot | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectionChanged, setSelectionChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/servers", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ServerManagerSnapshot & { error?: string };
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Falha ao consultar os servidores.");
      setSnapshot(body);
      setSelection((current) => selectionChanged ? current : body.selectedGameConfigs);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao consultar os servidores.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [router, selectionChanged]);

  useEffect(() => {
    const initialRequest = window.setTimeout(() => void loadStatus(), 0);
    const interval = window.setInterval(() => void loadStatus(true), 4000);
    return () => {
      window.clearTimeout(initialRequest);
      window.clearInterval(interval);
    };
  }, [loadStatus]);

  const coreServices = useMemo(
    () => snapshot?.services.filter((service) => service.kind === "core") ?? [],
    [snapshot],
  );
  const gameServices = useMemo(
    () => snapshot?.services.filter((service) => service.kind === "game") ?? [],
    [snapshot],
  );

  async function runAction(action: "start" | "stop" | "restart" | "start-all" | "stop-all", service?: ManagedServer) {
    if ((action === "stop-all" || action === "stop" || action === "restart") &&
      !window.confirm(action === "stop-all"
        ? "Parar todos os serviços do Dbo World? Jogadores conectados serão desconectados."
        : action === "stop" ? `Parar ${service?.name}?` : `Reiniciar ${service?.name}?`)) return;

    const key = service?.id ?? action;
    setPendingAction(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/servers/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(service ? { action, serviceId: service.id } : { action }),
      });
      const body = (await response.json().catch(() => ({}))) as ServerManagerSnapshot & { error?: string };
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Não foi possível executar a ação.");
      setSnapshot(body);
      setMessage(action === "start-all" ? "Serviços selecionados iniciados." :
        action === "stop-all" ? "Todos os serviços foram finalizados." :
        `${service?.name}: ação concluída.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível executar a ação.");
    } finally {
      setPendingAction("");
      void loadStatus(true);
    }
  }

  async function saveSelection() {
    setPendingAction("selection");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedGameConfigs: selection }),
      });
      const body = (await response.json().catch(() => ({}))) as ServerManagerSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a seleção.");
      setSnapshot(body);
      setSelection(body.selectedGameConfigs);
      setSelectionChanged(false);
      setMessage("Seleção padrão de GameServers salva.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a seleção.");
    } finally {
      setPendingAction("");
    }
  }

  function toggleConfig(file: string) {
    setSelection((current) => current.includes(file)
      ? current.filter((item) => item !== file)
      : [...current, file]);
    setSelectionChanged(true);
  }

  return (
    <section className="serverManagerPanel">
      <div className="serverToolbar">
        <div>
          <strong>Controle geral</strong>
          <span>{snapshot ? `${snapshot.services.filter((service) => service.status === "online").length} de ${snapshot.services.length} processos ativos` : "Consultando processos..."}</span>
        </div>
        <div className="serverToolbarActions">
          <button className="refreshButton" disabled={loading || Boolean(pendingAction)} onClick={() => void loadStatus()}>↻ Atualizar</button>
          <button className="secondaryButton serverActionButton" disabled={Boolean(pendingAction)} onClick={() => void runAction("stop-all")}>Parar todos</button>
          <button className="primaryButton compact" disabled={Boolean(pendingAction) || selection.length === 0} onClick={() => void runAction("start-all")}>
            {pendingAction === "start-all" ? "Iniciando..." : "Iniciar selecionados"}
          </button>
        </div>
      </div>

      {error && <div className="errorBanner"><strong>Falha no gerenciador</strong><span>{error}</span></div>}
      {message && <div className="successBanner"><strong>Ação concluída</strong><span>{message}</span></div>}
      {loading && !snapshot && <div className="loadingState"><span className="spinner" /> Lendo processos do Windows...</div>}

      {snapshot && (
        <>
          <div className="serverSectionHeader">
            <div><strong>Serviços centrais</strong><span>Executáveis fixos da pasta ExecutionEnv</span></div>
          </div>
          <div className="serverGrid">
            {coreServices.map((service) => (
              <ServerCard key={service.id} service={service} pending={pendingAction === service.id} onAction={runAction} />
            ))}
          </div>

          <div className="serverSectionHeader gameHeader">
            <div><strong>GameServers e canais</strong><span>Marque quais configurações serão usadas por “Iniciar selecionados”</span></div>
            <button className="secondaryButton saveSelectionButton" disabled={!selectionChanged || pendingAction === "selection"} onClick={() => void saveSelection()}>
              {pendingAction === "selection" ? "Salvando..." : "Salvar seleção padrão"}
            </button>
          </div>
          <div className="serverGrid gameServerGrid">
            {gameServices.map((service) => (
              <article className={`serverCard ${service.status}`} key={service.id}>
                <label className="serverSelection">
                  <input type="checkbox" checked={Boolean(service.configFile && selection.includes(service.configFile))} onChange={() => service.configFile && toggleConfig(service.configFile)} />
                  usar no início geral
                </label>
                <ServerCardBody service={service} pending={pendingAction === service.id} onAction={runAction} />
              </article>
            ))}
          </div>

          {snapshot.unmanagedGameProcesses.length > 0 && (
            <div className="warningBanner">
              <strong>GameServer sem canal identificado</strong>
              <span>{snapshot.unmanagedGameProcesses.map((process) => `PID ${process.pid}`).join(", ")}. Ele não correspondeu a uma porta dos arquivos permitidos e não será finalizado individualmente pelo painel.</span>
            </div>
          )}
          <p className="executionPath">Pasta gerenciada: <code>{snapshot.executionDirectory}</code></p>
        </>
      )}
    </section>
  );
}

function ServerCard({ service, pending, onAction }: {
  service: ManagedServer;
  pending: boolean;
  onAction: (action: "start" | "stop" | "restart", service: ManagedServer) => Promise<void>;
}) {
  return <article className={`serverCard ${service.status}`}><ServerCardBody service={service} pending={pending} onAction={onAction} /></article>;
}

function ServerCardBody({ service, pending, onAction }: {
  service: ManagedServer;
  pending: boolean;
  onAction: (action: "start" | "stop" | "restart", service: ManagedServer) => Promise<void>;
}) {
  return (
    <>
      <div className="serverCardHeader">
        <div><strong>{service.name}</strong><span>{service.executable}</span></div>
        <span className={`processBadge ${service.status}`}><i />{service.status === "online" ? "Ativo" : "Parado"}</span>
      </div>
      {service.kind === "game" && <div className="serverFacts"><span>Config <strong>{service.configFile}</strong></span><span>Porta <strong>{service.port}</strong></span></div>}
      <p className="processDetails">{service.pid ? `PID ${service.pid} · iniciado em ${formatStartedAt(service.startedAt)}` : "Nenhum processo encontrado"}</p>
      <div className="serverCardActions">
        {service.status === "offline" ? (
          <button className="secondaryButton" disabled={pending} onClick={() => void onAction("start", service)}>{pending ? "Iniciando..." : "Iniciar"}</button>
        ) : (
          <>
            <button className="secondaryButton" disabled={pending} onClick={() => void onAction("stop", service)}>{pending ? "Finalizando..." : "Parar"}</button>
            <button className="refreshButton" disabled={pending} onClick={() => void onAction("restart", service)}>Reiniciar</button>
          </>
        )}
      </div>
    </>
  );
}
