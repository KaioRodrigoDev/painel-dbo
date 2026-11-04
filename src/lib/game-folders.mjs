// Acha o cliente e o servidor colocados AO LADO do painel, sem configuracao.
//
// Fica em .mjs, sem dependencias, para ser usado tanto pelo Next (via game-paths.ts)
// quanto por scripts/iniciar-painel.mjs, que roda antes de existir node_modules.
//
// "Ao lado" e a pasta que contem a pasta do painel (process.cwd()/..):
//
//   C:\jogo\
//   ├── clientMDbo\pack\tbl.pak          <- cliente: qualquer pasta com pack\tbl.pak
//   ├── DboServer\ExecutionEnv\          <- servidor: DboServer\ExecutionEnv ou ExecutionEnv
//   └── painel-dbow\                     <- o painel
//
// Tambem vale o painel DENTRO da pasta do cliente (C:\jogo\clientMDbo\painel-dbow).
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Pasta onde o painel foi colocado, ao lado do jogo. @returns {string} */
export function panelParentDirectory() {
  return path.resolve(process.cwd(), "..");
}

/** @param {string} directory @returns {string[]} */
function subfolders(directory) {
  try {
    // Atalho de pasta (junction/symlink) tambem conta: nao e isDirectory() no readdir.
    return readdirSync(/* turbopackIgnore: true */ directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

const isClientPack = (/** @type {string} */ directory) => existsSync(/* turbopackIgnore: true */ path.join(directory, "tbl.pak"));
const isExecutionEnv = (/** @type {string} */ directory) =>
  existsSync(/* turbopackIgnore: true */ path.join(directory, "resource")) ||
  existsSync(/* turbopackIgnore: true */ path.join(directory, "config"));

// A busca le a pasta do jogo inteira; o resultado fica guardado, por pasta, enquanto
// continuar existindo.
/** @type {{ parent: string; clientPack: string | null; executionEnv: string | null }} */
const found = { parent: "", clientPack: null, executionEnv: null };

/** @param {string} parent */
function forget(parent) {
  if (found.parent !== parent) Object.assign(found, { parent, clientPack: null, executionEnv: null });
}

/**
 * Pasta `pack` de um cliente ao lado do painel, ou null. Com mais de um cliente, prefere
 * ClientRuntime_RealBase (o arranjo historico do repositorio) e depois a ordem alfabetica.
 * @returns {string | null}
 */
export function findClientPackNextToPanel() {
  const parent = panelParentDirectory();
  forget(parent);
  if (found.clientPack && isClientPack(found.clientPack)) return found.clientPack;
  const inside = path.join(parent, "pack");
  const packs = isClientPack(inside)
    ? [inside]
    : subfolders(parent).map((folder) => path.join(folder, "pack")).filter(isClientPack);
  found.clientPack =
    packs.find((pack) => path.basename(path.dirname(pack)).toLowerCase() === "clientruntime_realbase") ?? packs[0] ?? null;
  return found.clientPack;
}

/** Pasta ExecutionEnv de um servidor ao lado do painel, ou null. @returns {string | null} */
export function findExecutionEnvNextToPanel() {
  const parent = panelParentDirectory();
  forget(parent);
  if (found.executionEnv && isExecutionEnv(found.executionEnv)) return found.executionEnv;
  const candidates = [path.join(parent, "DboServer", "ExecutionEnv"), path.join(parent, "ExecutionEnv")];
  for (const folder of subfolders(parent)) {
    candidates.push(path.join(folder, "DboServer", "ExecutionEnv"), path.join(folder, "ExecutionEnv"));
  }
  found.executionEnv = candidates.find(isExecutionEnv) ?? null;
  return found.executionEnv;
}
