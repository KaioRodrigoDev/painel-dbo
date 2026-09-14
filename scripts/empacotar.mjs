// Monta a pasta do painel pronta para enviar a outra pessoa.
//
// O que NAO vai, e por que:
//
//   .env.local      tem senha do painel e do banco -- nunca sai daqui
//   data/           auditoria, rascunhos e backups da SUA instalacao
//   node_modules/   quem recebe roda `npm install`
//   .next/          build; quem recebe roda `npm run build`
//   *.md de projeto notas internas de desenvolvimento
//
// Uso: node scripts/empacotar.mjs [pasta-de-saida]
import { cp, mkdir, rm, readdir, stat, access } from "node:fs/promises";
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
