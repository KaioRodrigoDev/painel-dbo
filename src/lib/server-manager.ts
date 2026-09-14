import "server-only";

import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import type { ManagedServer, ServerManagerSnapshot } from "@/lib/types";
import { getAccountDatabaseConfig } from "@/lib/env";
import { resolveExecutionEnv } from "@/lib/game-paths";

const execFileAsync = promisify(execFile);
const DATA_DIRECTORY = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIRECTORY, "server-manager-settings.json");
const STATE_FILE = path.join(DATA_DIRECTORY, "server-manager-state.json");
const START_DELAY_MS = 1000;

const CORE_SERVICES = [
  { id: "master", name: "MasterServer", processName: "MasterServer", executable: "MasterServer.exe", args: [] },
  { id: "query", name: "QueryServer", processName: "QueryServer", executable: "QueryServer.exe", args: [] },
  { id: "auth", name: "AuthServer", processName: "AuthServer", executable: "AuthServer.exe", args: [] },
  { id: "char", name: "CharServer", processName: "CharServer", executable: "CharServer.exe", args: [".\\config\\CharServer.ini"] },
  { id: "chat", name: "ChatServer", processName: "ChatServer", executable: "ChatServer.exe", args: [".\\config\\ChatServer.ini"] },
] as const;

type ProcessRecord = {
  pid: number;
  name: string;
  executablePath: string | null;
  startedAt: string | null;
};

type GameConfig = {
  file: string;
  channel: number;
  port: number;
  channelName: string | null;
};

type ManagerSettings = { selectedGameConfigs: string[] };
type ManagerState = { processes: Record<string, { pid: number; startedAt: string }> };

let operationQueue: Promise<unknown> = Promise.resolve();

function executionDirectory() {
  return resolveExecutionEnv();
}

function normalized(value: string) {
  return path.normalize(value).toLocaleLowerCase("en-US");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertDatabaseAvailable() {
  const database = getAccountDatabaseConfig();
  const available = await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: database.host, port: database.port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
  if (!available) {
    throw new Error(
      `O MySQL não está acessível em ${database.host}:${database.port}. Inicie o banco antes dos servidores do Dbo World.`,
    );
  }
}

async function writeJsonAtomically(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

function parseGameConfig(file: string, contents: string): GameConfig {
  let section = "";
  const values = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    if (section !== "game server") continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    values.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim(),
    );
  }

  const channel = Number(values.get("channel"));
  const port = Number(values.get("port"));
  if (!Number.isInteger(channel) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Configuração inválida em ${file}: Channel e Port são obrigatórios.`);
  }
  return {
    file,
    channel,
    port,
    channelName: values.get("channelname") || null,
  };
}

function gameConfigOrder(left: GameConfig, right: GameConfig) {
  const preferred = ["gameserver.ini", "gameserver9.ini", "gameserver1.ini"];
  const leftIndex = preferred.indexOf(left.file.toLowerCase());
  const rightIndex = preferred.indexOf(right.file.toLowerCase());
  if (leftIndex >= 0 || rightIndex >= 0) {
    return (leftIndex < 0 ? preferred.length : leftIndex) -
      (rightIndex < 0 ? preferred.length : rightIndex);
  }
  return left.channel - right.channel || left.file.localeCompare(right.file);
}

async function discoverGameConfigs(): Promise<GameConfig[]> {
  const directory = path.join(executionDirectory(), "config");
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(directory))
    .filter((name) => /^GameServer\d*\.ini$/i.test(name));
  const configs = await Promise.all(
    names.map(async (file) => parseGameConfig(file, await readFile(path.join(directory, file), "utf8"))),
  );
  return configs.sort(gameConfigOrder);
}

function withoutChannelConflicts(configs: GameConfig[]) {
  const ports = new Set<number>();
  const channels = new Set<number>();
  return configs.filter((config) => {
    if (ports.has(config.port) || channels.has(config.channel)) return false;
    ports.add(config.port);
    channels.add(config.channel);
    return true;
  });
}

async function validateInstallation() {
  if (process.platform !== "win32") {
    throw new Error("O gerenciador de servidores está disponível apenas no Windows.");
  }
  await Promise.all([
    ...CORE_SERVICES.map((service) => access(path.join(/* turbopackIgnore: true */ executionDirectory(), service.executable))),
    access(path.join(/* turbopackIgnore: true */ executionDirectory(), "GameServer.exe")),
  ]);
}

async function listProcesses(): Promise<ProcessRecord[]> {
  const names = [...CORE_SERVICES.map((service) => service.processName), "GameServer"];
  const script = [
    `$names = @(${names.map((name) => `'${name}'`).join(",")})`,
    "$result = @(Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object {",
    "  $started = $null; try { $started = $_.StartTime.ToUniversalTime().ToString('o') } catch {}",
    "  $file = $null; try { $file = $_.Path } catch {}",
    "  [PSCustomObject]@{ pid = $_.Id; name = $_.ProcessName; executablePath = $file; startedAt = $started }",
    "})",
    "$result | ConvertTo-Json -Compress",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  const value = stdout.trim();
  if (!value) return [];
  const parsed = JSON.parse(value) as ProcessRecord | ProcessRecord[];
  return (Array.isArray(parsed) ? parsed : [parsed]).map((process) => ({
    ...process,
    pid: Number(process.pid),
  }));
}

async function listeningPorts(): Promise<Map<number, number>> {
  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "TCP"], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const result = new Map<number, number>();
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (match) result.set(Number(match[1]), Number(match[2]));
    }
    return result;
  } catch {
    return new Map();
  }
}

async function settingsFor(configs: GameConfig[]): Promise<ManagerSettings> {
  const available = new Set(configs.map((config) => config.file));
  const saved = await readJson<ManagerSettings | null>(SETTINGS_FILE, null);
  const requested = saved
    ? saved.selectedGameConfigs.filter((file) => available.has(file))
    : configs.map((config) => config.file);
  return {
    selectedGameConfigs: withoutChannelConflicts(
      configs.filter((config) => requested.includes(config.file)),
    ).map((config) => config.file),
  };
}

async function state() {
  return readJson<ManagerState>(STATE_FILE, { processes: {} });
}

function belongsToExecutionDirectory(process: ProcessRecord, expectedExecutable: string) {
  if (!process.executablePath) return false;
  return normalized(process.executablePath) === normalized(path.join(/* turbopackIgnore: true */ executionDirectory(), expectedExecutable));
}

export async function getServerSnapshot(): Promise<ServerManagerSnapshot> {
  await validateInstallation();
  const configs = await discoverGameConfigs();
  const [processes, ports, managerSettings, managerState] = await Promise.all([
    listProcesses(),
    listeningPorts(),
    settingsFor(configs),
    state(),
  ]);
  const assignedPids = new Set<number>();
  const services: ManagedServer[] = [];

  for (const definition of CORE_SERVICES) {
    const expectedName = definition.processName.toLowerCase();
    const candidates = processes.filter(
      (process) => process.name.toLowerCase() === expectedName && belongsToExecutionDirectory(process, definition.executable),
    );
    const savedPid = managerState.processes[definition.id]?.pid;
    const process = candidates.find((candidate) => candidate.pid === savedPid) ?? candidates[0] ?? null;
    if (process) assignedPids.add(process.pid);
    services.push({
      id: definition.id,
      kind: "core",
      name: definition.name,
      executable: definition.executable,
      configFile: definition.args[0] ?? null,
      channel: null,
      port: null,
      channelName: null,
      selected: true,
      status: process ? "online" : "offline",
      pid: process?.pid ?? null,
      startedAt: process?.startedAt ?? null,
    });
  }

  const gameProcesses = processes.filter(
    (process) => process.name.toLowerCase() === "gameserver" && belongsToExecutionDirectory(process, "GameServer.exe"),
  );
  for (const config of configs) {
    const id = `game:${config.file}`;
    const savedPid = managerState.processes[id]?.pid;
    const portPid = ports.get(config.port);
    const process = gameProcesses.find(
      (candidate) => !assignedPids.has(candidate.pid) &&
        (candidate.pid === savedPid || candidate.pid === portPid),
    ) ?? null;
    if (process) assignedPids.add(process.pid);
    services.push({
      id,
      kind: "game",
      name: config.channelName ? `Canal ${config.channel} - ${config.channelName}` : `Canal ${config.channel}`,
      executable: "GameServer.exe",
      configFile: config.file,
      channel: config.channel,
      port: config.port,
      channelName: config.channelName,
      selected: managerSettings.selectedGameConfigs.includes(config.file),
      status: process ? "online" : "offline",
      pid: process?.pid ?? null,
      startedAt: process?.startedAt ?? null,
    });
  }

  const livePids = new Set(processes.map((process) => process.pid));
  const thirtySecondsAgo = Date.now() - 30_000;
  const cleanProcesses = Object.fromEntries(
    Object.entries(managerState.processes).filter(([, value]) =>
      livePids.has(value.pid) || new Date(value.startedAt).getTime() >= thirtySecondsAgo),
  );
  if (Object.keys(cleanProcesses).length !== Object.keys(managerState.processes).length) {
    await writeJsonAtomically(STATE_FILE, { processes: cleanProcesses });
  }

  return {
    executionDirectory: executionDirectory(),
    services,
    selectedGameConfigs: managerSettings.selectedGameConfigs,
    unmanagedGameProcesses: gameProcesses
      .filter((process) => !assignedPids.has(process.pid))
      .map((process) => ({ pid: process.pid, startedAt: process.startedAt })),
    updatedAt: new Date().toISOString(),
  };
}

export async function saveSelectedGameConfigs(files: string[]) {
  const configs = await discoverGameConfigs();
  const available = new Set(configs.map((config) => config.file));
  const unique = [...new Set(files)];
  if (unique.some((file) => !available.has(file))) {
    throw new Error("A seleção contém um arquivo de GameServer não permitido.");
  }
  const selectedConfigs = configs.filter((config) => unique.includes(config.file));
  if (withoutChannelConflicts(selectedConfigs).length !== selectedConfigs.length) {
    throw new Error("A seleção contém GameServers com o mesmo Channel ou Port.");
  }
  await writeJsonAtomically(SETTINGS_FILE, { selectedGameConfigs: unique });
  return getServerSnapshot();
}

async function rememberProcess(id: string, pid: number) {
  const managerState = await state();
  managerState.processes[id] = { pid, startedAt: new Date().toISOString() };
  await writeJsonAtomically(STATE_FILE, managerState);
}

async function forgetProcess(id: string) {
  const managerState = await state();
  delete managerState.processes[id];
  await writeJsonAtomically(STATE_FILE, managerState);
}

function validateCmdArgument(value: string) {
  if (/[\r\n"&|<>^%]/.test(value)) {
    throw new Error("O caminho do DBOW contém caracteres incompatíveis com o inicializador do Windows.");
  }
}

async function hideProcessWindow(pid: number) {
  const script = [
    "Add-Type -Namespace DboWorld -Name Window -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);'",
    "$process = Get-Process -Id ([int]$env:DBOW_MANAGER_PID) -ErrorAction SilentlyContinue",
    "for ($attempt = 0; $process -and $process.MainWindowHandle -eq 0 -and $attempt -lt 20; $attempt++) {",
    "  Start-Sleep -Milliseconds 100",
    "  $process.Refresh()",
    "}",
    "if ($process -and $process.MainWindowHandle -ne 0) { $null = [DboWorld.Window]::ShowWindowAsync($process.MainWindowHandle, 0) }",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true,
    timeout: 5000,
    env: { ...process.env, DBOW_MANAGER_PID: String(pid) },
  }).catch(() => undefined);
}

async function startService(service: ManagedServer) {
  if (service.status === "online") return;
  const executable = path.join(/* turbopackIgnore: true */ executionDirectory(), service.executable);
  const args = service.kind === "game"
    ? [`.\\config\\${service.configFile}`]
    : [...(CORE_SERVICES.find((item) => item.id === service.id)?.args ?? [])];
  const expectedName = path.basename(service.executable, ".exe").toLowerCase();
  const before = new Set(
    (await listProcesses())
      .filter((process) => process.name.toLowerCase() === expectedName && belongsToExecutionDirectory(process, service.executable))
      .map((process) => process.pid),
  );
  const commandValues = [executionDirectory(), executable, ...args];
  commandValues.forEach(validateCmdArgument);
  await execFileAsync("cmd.exe", [
    "/d", "/c", "start", "", "/min", "/d", executionDirectory(), executable, ...args,
  ], {
    windowsHide: true,
    timeout: 10000,
  });
  let pid = 0;
  for (let attempt = 0; attempt < 30 && pid === 0; attempt++) {
    await delay(100);
    const process = (await listProcesses()).find(
      (candidate) => candidate.name.toLowerCase() === expectedName &&
        !before.has(candidate.pid) && belongsToExecutionDirectory(candidate, service.executable),
    );
    pid = process?.pid ?? 0;
  }
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`Não foi possível iniciar ${service.name}.`);
  await rememberProcess(service.id, pid);
  await hideProcessWindow(pid);
  await delay(START_DELAY_MS);
  const current = (await getServerSnapshot()).services.find((item) => item.id === service.id);
  if (current?.status !== "online") {
    await forgetProcess(service.id);
    throw new Error(`${service.name} encerrou durante a inicialização. Consulte o log do servidor.`);
  }
}

async function stopService(service: ManagedServer) {
  if (service.status === "offline" || !service.pid) {
    await forgetProcess(service.id);
    return;
  }
  const snapshot = await getServerSnapshot();
  const current = snapshot.services.find((item) => item.id === service.id);
  if (!current?.pid || current.pid !== service.pid) {
    throw new Error(`O processo de ${service.name} mudou; atualize o status antes de parar.`);
  }
  try {
    await execFileAsync("taskkill.exe", ["/PID", String(current.pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 15000,
    });
  } catch (error) {
    const snapshotAfterFailure = await getServerSnapshot();
    if (snapshotAfterFailure.services.find((item) => item.id === service.id)?.status === "online") {
      throw error;
    }
  }
  await forgetProcess(service.id);
  await delay(300);
}

async function performAction(action: "start" | "stop" | "restart" | "start-all" | "stop-all", serviceId?: string) {
  const snapshot = await getServerSnapshot();
  if (action === "start-all") {
    await assertDatabaseAvailable();
    const selected = new Set(snapshot.selectedGameConfigs);
    const byId = new Map(snapshot.services.map((service) => [service.id, service]));
    const sequence = ["master", "query", "auth", "char"];
    const games = snapshot.services.filter(
      (service) => service.kind === "game" && service.configFile && selected.has(service.configFile),
    );
    const primary = games.find((service) => service.channel === 0);
    if (primary) sequence.push(primary.id);
    sequence.push("chat");
    sequence.push(...games.filter((service) => service.id !== primary?.id).map((service) => service.id));
    const newlyStarted: string[] = [];
    try {
      for (const id of sequence) {
        const current = (await getServerSnapshot()).services.find((service) => service.id === id) ?? byId.get(id);
        if (current?.status === "offline") {
          await startService(current);
          newlyStarted.push(id);
        }
      }
      await delay(2000);
      const finalSnapshot = await getServerSnapshot();
      const missing = sequence
        .map((id) => finalSnapshot.services.find((service) => service.id === id))
        .filter((service) => !service || service.status !== "online")
        .map((service) => service?.name ?? "serviço desconhecido");
      if (missing.length > 0) {
        throw new Error(`A inicialização não estabilizou: ${missing.join(", ")}.`);
      }
      return finalSnapshot;
    } catch (error) {
      for (const id of [...newlyStarted].reverse()) {
        const current = (await getServerSnapshot()).services.find((service) => service.id === id);
        if (current?.status === "online") await stopService(current).catch(() => undefined);
      }
      const reason = error instanceof Error ? error.message : "falha desconhecida";
      throw new Error(`A inicialização foi desfeita porque um serviço falhou: ${reason}`);
    }
  }
  if (action === "stop-all") {
    const reverse = [...snapshot.services].reverse();
    for (const service of reverse) await stopService(service);
    for (const process of snapshot.unmanagedGameProcesses) {
      await execFileAsync("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 15000,
      }).catch(() => undefined);
    }
    return getServerSnapshot();
  }

  const service = snapshot.services.find((item) => item.id === serviceId);
  if (!service) throw new Error("Servidor não encontrado ou não permitido.");
  if ((action === "start" || action === "restart") && service.id !== "master") {
    await assertDatabaseAvailable();
  }
  if (action === "start") await startService(service);
  if (action === "stop") await stopService(service);
  if (action === "restart") {
    await stopService(service);
    const refreshed = (await getServerSnapshot()).services.find((item) => item.id === service.id);
    if (refreshed) await startService(refreshed);
  }
  return getServerSnapshot();
}

export function runServerAction(
  action: "start" | "stop" | "restart" | "start-all" | "stop-all",
  serviceId?: string,
) {
  const operation = operationQueue.then(() => performAction(action, serviceId));
  operationQueue = operation.catch(() => undefined);
  return operation;
}
