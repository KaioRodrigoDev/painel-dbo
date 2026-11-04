// Monta a pasta do painel pronta para enviar a outra pessoa.
//
// O que NAO vai, e por que:
//
//   .env.local      tem senha do painel e do banco -- nunca sai daqui
//   data/           auditoria, rascunhos e backups da SUA instalacao
//   node_modules/   quem recebe abre "Iniciar painel.bat", que roda `npm ci`
//   .next/          build; o mesmo .bat compila na primeira vez
//   *.md de projeto notas internas de desenvolvimento
//
// Com o WinRAR instalado, gera tambem painel-dbow.rar ao lado da pasta de saida. Quem
// recebe extrai ao lado do cliente (e do DboServer, se tiver) e abre o .bat: o painel
// acha o jogo sozinho (src/lib/game-folders.mjs) e a senha do pack tambem.
//
// Uso: node scripts/empacotar.mjs [pasta-de-saida]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, readdir, readFile, stat, access, writeFile } from "node:fs/promises";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const saida = path.resolve(process.argv[2] ?? path.join(raiz, "..", "dbow-admin-para-enviar"));

// Copiados na integra
const PASTAS = ["src", "public", "scripts"];

// Copiados um a um
const ARQUIVOS = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "next-env.d.ts",
  ".env.example",
  "INSTALACAO.md",
  "Iniciar painel.bat",
];

// Nao pode aparecer no resultado, de jeito nenhum
const PROIBIDOS = [".env.local", ".env", "data", "node_modules", ".next"];

const existe = async (p) => access(p).then(() => true, () => false);

console.log(`origem : ${raiz}`);
console.log(`destino: ${saida}\n`);

if (await existe(saida)) {
  await rm(saida, { recursive: true, force: true });
  console.log("destino anterior removido\n");
}
await mkdir(saida, { recursive: true });

for (const pasta of PASTAS) {
  const origem = path.join(raiz, pasta);
  if (!(await existe(origem))) { console.log(`  (pulado) ${pasta}/ nao existe`); continue; }
  await cp(origem, path.join(saida, pasta), { recursive: true });
  console.log(`  copiado ${pasta}/`);
}

for (const arquivo of ARQUIVOS) {
  const origem = path.join(raiz, arquivo);
  if (!(await existe(origem))) { console.log(`  (pulado) ${arquivo} nao existe`); continue; }
  await cp(origem, path.join(saida, arquivo));
  console.log(`  copiado ${arquivo}`);
}

// Carimbo do pacote: o .bat recompila quando ele muda (pacote novo extraido por cima).
await writeFile(path.join(saida, ".pacote"), new Date().toISOString());

// --- conferencia: nada sensivel escapou -------------------------------------
console.log("\nconferencia:");
let falhou = false;

for (const proibido of PROIBIDOS) {
  if (await existe(path.join(saida, proibido))) {
    console.log(`  FALHA  ${proibido} foi parar no pacote`);
    falhou = true;
  }
}
if (!falhou) console.log(`  OK     nenhum item sensivel no pacote (${PROIBIDOS.join(", ")})`);

// varredura recursiva atras de segredo esquecido em qualquer nivel
const suspeitos = [];
async function varre(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) { await varre(completo); continue; }
    if (/^\.env($|\.)/.test(item.name) && item.name !== ".env.example") {
      suspeitos.push(path.relative(saida, completo));
    }
  }
}
await varre(saida);

if (suspeitos.length) {
  console.log(`  FALHA  arquivos de ambiente encontrados: ${suspeitos.join(", ")}`);
  falhou = true;
} else {
  console.log("  OK     nenhum .env alem do .env.example");
}

// As senhas do SEU .env.local nao podem aparecer em nenhum arquivo do pacote.
const segredos = [];
const envLocal = await readFile(path.join(raiz, ".env.local"), "utf8").catch(() => "");
for (const linha of envLocal.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]*(?:PASSWORD|SECRET)[A-Z0-9_]*)\s*=\s*(.*)$/.exec(linha);
  const valor = m?.[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  if (valor && valor.length >= 6) segredos.push({ chave: m[1], valor });
}
const vazados = [];
async function procura(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) { await procura(completo); continue; }
    const conteudo = await readFile(completo, "latin1");
    for (const { chave, valor } of segredos) {
      if (conteudo.includes(valor)) vazados.push(`${chave} em ${path.relative(saida, completo)}`);
    }
  }
}
await procura(saida);
if (vazados.length) {
  console.log(`  FALHA  senha do seu .env.local dentro do pacote: ${vazados.join(", ")}`);
  falhou = true;
} else {
  console.log(`  OK     nenhuma senha do seu .env.local nos arquivos (${segredos.length} conferidas)`);
}

if (!(await existe(path.join(saida, "INSTALACAO.md")))) {
  console.log("  FALHA  INSTALACAO.md nao esta no pacote");
  falhou = true;
} else {
  console.log("  OK     INSTALACAO.md incluido");
}

// --- tamanho ----------------------------------------------------------------
let bytes = 0, arquivos = 0;
async function soma(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) { await soma(completo); continue; }
    bytes += (await stat(completo)).size;
    arquivos += 1;
  }
}
await soma(saida);

console.log(`\n${arquivos} arquivos, ${(bytes / 1048576).toFixed(1)} MB`);

if (falhou) {
  console.log("\nPACOTE REPROVADO -- nao envie.");
  process.exit(1);
}

console.log("\nPacote pronto. Quem receber deve ler INSTALACAO.md.");

// --- .rar -------------------------------------------------------------------
const rar = ["C:\\Program Files\\WinRAR\\Rar.exe", "C:\\Program Files (x86)\\WinRAR\\Rar.exe"].find((p) => existsSync(p));
if (!rar) {
  console.log("\nWinRAR nao encontrado: compacte a pasta acima a mao.");
} else {
  const arquivo = path.join(path.dirname(saida), "painel-dbow.rar");
  await rm(arquivo, { force: true });
  // -ep1 + -ap: dentro do .rar tudo fica sob painel-dbow\, qualquer que seja a pasta de saida.
  const r = spawnSync(rar, ["a", "-r", "-ep1", "-appainel-dbow", "-idq", "-y", arquivo, path.join(saida, "*")], { stdio: "inherit" });
  if (r.status !== 0) {
    console.log(`\nFALHA ao gerar ${arquivo} (Rar.exe saiu com ${r.status}).`);
    process.exit(1);
  }
  console.log(`\n.rar pronto: ${arquivo} (${((await stat(arquivo)).size / 1048576).toFixed(1)} MB)`);
}
