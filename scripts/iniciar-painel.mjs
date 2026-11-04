// Sobe o painel com dois cliques em "Iniciar painel.bat", para quem recebeu a pasta pronta
// (scripts/empacotar.mjs) e a colocou ao lado do cliente.
//
// Na primeira vez:
//   1. cria o .env.local -- senha de acesso aleatoria e banco lido do QueryServer.ini do
//      servidor ao lado, se houver (o mesmo que scripts/import-dbow-config.mjs faz);
//   2. instala as dependencias (npm ci) e compila (next build).
// Depois: so sobe o servidor em http://127.0.0.1 e abre o navegador.
//
// Cliente e servidor sao achados por src/lib/game-folders.mjs, a mesma regra do painel.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findClientPackNextToPanel, findExecutionEnvNextToPanel } from "../src/lib/game-folders.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(raiz);

const NEXT_BIN = path.join("node_modules", "next", "dist", "bin", "next");
// Escrito por empacotar.mjs; muda a cada pacote novo, e um pacote novo precisa de build novo.
const CARIMBO = ".pacote";
const CARIMBO_DO_BUILD = path.join(".next", ".pacote");

function parar(mensagem) {
  console.error(`\n${mensagem}`);
  process.exit(1);
}

// --- Node ---------------------------------------------------------------------
const [maior, menor] = process.versions.node.split(".").map(Number);
if (maior < 20 || (maior === 20 && menor < 9)) {
  parar(`Node.js ${process.versions.node} é antigo demais. Instale o Node.js 20.9 ou mais novo (LTS) em https://nodejs.org.`);
}

// --- .env.local -----------------------------------------------------------------
function parseIni(source) {
  const sections = {};
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      current = section[1];
      sections[current] ??= {};
      continue;
    }
    const separator = line.indexOf("=");
    if (current && separator > 0) sections[current][line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return sections;
}

const envValue = (value) => JSON.stringify(String(value).replaceAll("$", "\\$"));

function bancoDoIni(section, padraoDb) {
  return {
    HOST: section?.Host ?? "127.0.0.1",
    PORT: section?.Port ?? "3306",
    USER: section?.User ?? "root",
    PASSWORD: section?.Password ?? "",
    NAME: section?.Db ?? section?.DbName ?? padraoDb,
  };
}

function criarEnvLocal() {
  const executionEnv = findExecutionEnvNextToPanel();
  const ini = executionEnv ? path.join(executionEnv, "config", "QueryServer.ini") : null;
  const sections = ini && existsSync(ini) ? parseIni(readFileSync(ini, "utf8")) : null;
  const conta = bancoDoIni(sections?.DATABASE_ACCOUNT, "mdbo_acc");
  const personagem = bancoDoIni(sections?.DATABASE_CHARACTER, "mdbo_char");
  const senha = randomBytes(18).toString("base64url");

  const linhas = [
    `# Criado por "Iniciar painel.bat" em ${new Date().toLocaleString("pt-BR")}.`,
    "# Pode editar: vale na proxima vez que o painel for aberto. Nao envie este arquivo a ninguem.",
    "",
    `ADMIN_USERNAME=${envValue("admin")}`,
    `ADMIN_PASSWORD=${envValue(senha)}`,
    `SESSION_SECRET=${envValue(randomBytes(48).toString("base64url"))}`,
    `ADMIN_COOKIE_SECURE=${envValue("false")}`,
    "",
    sections
      ? `# Banco lido de ${ini}`
      : "# Nao achei o QueryServer.ini de um servidor ao lado do painel: preencha com os dados do seu MySQL.",
    ...Object.entries(conta).map(([chave, valor]) => `ACCOUNT_DB_${chave}=${envValue(valor)}`),
    ...Object.entries(personagem).map(([chave, valor]) => `CHARACTER_DB_${chave}=${envValue(valor)}`),
    "",
    "# Cliente e servidor sao achados sozinhos ao lado do painel, e a senha do pack tambem.",
    "# Para apontar outro lugar ou outra senha, veja .env.example (CLIENT_PACK_DIRECTORY,",
    "# DBOW_EXECUTION_ENV, CLIENT_PACK_PASSWORD).",
    "",
  ];
  writeFileSync(".env.local", linhas.join("\r\n"), { encoding: "utf8", flag: "wx" });

  console.log("Configuração criada em .env.local");
  console.log(sections ? `  banco: lido de ${ini}` : "  banco: NÃO configurado -- edite .env.local com os dados do seu MySQL");
  console.log("");
  console.log("  ==============================================");
  console.log("   Acesso ao painel");
  console.log("     usuário: admin");
  console.log(`     senha:   ${senha}`);
  console.log("   (fica guardada em .env.local)");
  console.log("  ==============================================\n");
}

if (!existsSync(".env.local")) criarEnvLocal();

// --- dependencias e build ---------------------------------------------------------
function rodar(titulo, comando, args, opcoes = {}) {
  console.log(`\n${titulo}`);
  const resultado = spawnSync(comando, args, { stdio: "inherit", ...opcoes });
  return resultado.status === 0;
}

if (!existsSync(path.join("node_modules", "next", "package.json"))) {
  const instalar = existsSync("package-lock.json") ? "ci" : "install";
  // npm e um .cmd no Windows: precisa de shell.
  if (!rodar("Instalando dependências (só na primeira vez, precisa de internet)...", "npm", [instalar], { shell: true })) {
    parar("A instalação das dependências falhou. Confira a internet e abra o painel de novo.");
  }
}

const carimbo = existsSync(CARIMBO) ? readFileSync(CARIMBO, "utf8") : null;
const buildAtual =
  existsSync(path.join(".next", "BUILD_ID")) &&
  (carimbo === null || (existsSync(CARIMBO_DO_BUILD) && readFileSync(CARIMBO_DO_BUILD, "utf8") === carimbo));
if (!buildAtual) {
  if (!rodar("Compilando o painel (só na primeira vez, leva alguns minutos)...", process.execPath, [NEXT_BIN, "build"])) {
    parar("A compilação falhou. Envie a mensagem acima para quem te mandou o painel.");
  }
  if (carimbo !== null) copyFileSync(CARIMBO, CARIMBO_DO_BUILD);
}

// --- servidor ---------------------------------------------------------------------
const portaLivre = (porta) =>
  new Promise((resolve) => {
    const teste = net.createServer();
    teste.once("error", () => resolve(false));
    teste.listen(porta, "127.0.0.1", () => teste.close(() => resolve(true)));
  });

let porta = Number(process.env.PORT ?? 3000);
while (!(await portaLivre(porta))) {
  if (porta >= 3020) parar("As portas 3000 a 3020 estão ocupadas. Feche o outro programa e abra o painel de novo.");
  porta += 1;
}
const endereco = `http://localhost:${porta}`;

const cliente = findClientPackNextToPanel();
console.log(`\nCliente ao lado do painel: ${cliente ? path.dirname(cliente) : "nenhum encontrado"}`);
console.log(`Servidor ao lado do painel: ${findExecutionEnvNextToPanel() ?? "nenhum encontrado"}`);
console.log(`\nAbrindo o painel em ${endereco} -- deixe esta janela aberta; feche-a para desligar o painel.\n`);

const servidor = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(porta)], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
servidor.on("exit", (codigo) => process.exit(codigo ?? 0));

// Abre o navegador quando o servidor responder (PAINEL_SEM_NAVEGADOR=1 nao abre; usado em teste).
for (let tentativa = 0; tentativa < 120 && !process.env.PAINEL_SEM_NAVEGADOR; tentativa += 1) {
  const pronto = await fetch(`http://127.0.0.1:${porta}/login`).then(
    () => true,
    () => false,
  );
  if (pronto) {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", endereco], { stdio: "ignore", detached: true }).unref();
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
