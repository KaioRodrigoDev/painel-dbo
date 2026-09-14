// Troca as superficies da marca de canal para um esquema por NOME DE COR.
//
// Antes o cliente escolhia a superficie pelo nivel de VIP (srfVipIcon, srfVipIcon2...),
// o que impedia um canal comum de ter marca. Agora o nome vem do ChannelIcon no .ini e
// o cliente monta "srfChannelIcon" + esse nome -- entao as superficies passam a se
// chamar pela cor, nao pelo nivel.
//
// Continua sem imagem nova: todas apontam para a MESMA regiao da textura, mudando so
// color_red/green/blue, que o cliente aplica nos vertices.
//
// Uso: node --experimental-strip-types scripts/set-channel-icons.ts [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";

const aplicar = process.argv.includes("--apply");
const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

// marca de Zenny na rsrRaceCommon -- a mesma que o icone de evento usa
const UV = { left: 493, top: 113, right: 509, bottom: 129 };

const CORES = [
  { nome: "Gold", r: 255, g: 255, b: 255 },   // sem tingimento: a cor natural da marca
  { nome: "Red", r: 255, g: 48, b: 48 },
  { nome: "Blue", r: 120, g: 180, b: 255 },
];

const alvos = [
  { arquivo: ".\\gui\\channelchange.srf", resource: "Game.rsr" },
  { arquivo: ".\\gui\\charchannelselect.srf", resource: "Lobby.rsr" },
];

const bloco = (nome: string, resourceFile: string, cor: { r: number; g: number; b: number }) =>
  [
    "",
    `surface "srfChannelIcon${nome}"`,
    "{",
    `\tresource_file\t= "${resourceFile}";`,
    '\tresource_name\t= "rsrRaceCommon";',
    "",
    "\tx\t\t= 0;",
    "\ty\t\t= 0;",
    `\twidth\t\t= ${UV.right - UV.left};`,
    `\theight\t\t= ${UV.bottom - UV.top};`,
    "",
    `\tcolor_red\t= ${cor.r};`,
    `\tcolor_green\t= ${cor.g};`,
    `\tcolor_blue\t= ${cor.b};`,
    "\tcolor_alpha\t= 255;",
    "",
    `\tuv_left\t\t= ${UV.left};`,
    `\tuv_top\t\t= ${UV.top};`,
    `\tuv_right\t= ${UV.right};`,
    `\tuv_bottom\t= ${UV.bottom};`,
    "",
    "\thandle\t\t= 0;",
    "\tblend\t\t= 0;",
    "}",
    "",
  ].join("\r\n");

const falhas: string[] = [];
const check = (ok: boolean, t: string) => { console.log(`  ${ok ? "OK  " : "FALHA"} ${t}`); if (!ok) falhas.push(t); };

const indicePath = path.join(directory, "gui.pak");
const index = decryptPackHeader(await readFile(indicePath));
const records = scanIndexRecords(index);
const unidade = records.find((r) => r.name.toLowerCase() === alvos[0].arquivo.toLowerCase())!.unit;
const unitPath = path.join(directory, `gui${unidade}.pak`);
const unitContent = await readFile(unitPath);

const substituicoes = new Map<string, Buffer>();
for (const alvo of alvos) {
  const r = records.find((x) => x.name.toLowerCase() === alvo.arquivo.toLowerCase())!;
  let texto = unitContent.subarray(r.offset, r.offset + r.size).toString("latin1");

  // tira o esquema antigo, por nivel
  const antes = texto.length;
  texto = texto.replace(/\s*surface\s+"srfVipIcon\d?"\s*\{[^}]*\}/g, "");
  check(texto.length < antes, `${alvo.arquivo}: removeu as superficies antigas por nivel`);
  check(!texto.includes("srfVipIcon"), `${alvo.arquivo}: nao sobrou nenhuma srfVipIcon`);

  // o icone de evento do Scramble tem que continuar intacto
  check(texto.includes('surface "srfDBSSmallIcon"'), `${alvo.arquivo}: srfDBSSmallIcon preservada`);

  for (const cor of CORES) {
    texto = texto.replace(/\s*$/, "\r\n") + bloco(cor.nome, alvo.resource, cor);
  }

  substituicoes.set(r.name, Buffer.from(texto, "latin1"));
}

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificacao(oes); nada gravado.`); process.exit(1); }

const antesMap = new Map(records.map((r) => [r.name, `${r.unit}:${r.size}`]));
const reconstruido = rebuildPackUnit({ index, records, unit: unidade, unitContent, replacements: substituicoes });
const novos = scanIndexRecords(reconstruido.index);

console.log("\nverificacoes:");
check(novos.length === records.length, `a contagem de arquivos nao mudou (${novos.length})`);
check(
  [...antesMap].filter(([n]) => !substituicoes.has(n)).every(([n, chave]) => {
    const x = novos.find((y) => y.name === n);
    return x && `${x.unit}:${x.size}` === chave;
  }),
  "os outros arquivos do pack mantiveram unidade e tamanho",
);

for (const [nome, conteudo] of substituicoes) {
  const x = novos.find((y) => y.name === nome)!;
  const lido = reconstruido.unitContent.subarray(x.offset, x.offset + x.size);
  check(lido.equals(conteudo), `${nome} rele identico pelo indice`);
  for (const cor of CORES) {
    check(lido.toString("latin1").includes(`surface "srfChannelIcon${cor.nome}"`), `${nome} contem srfChannelIcon${cor.nome}`);
  }
}

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificacao(oes); nada gravado.`); process.exit(1); }
if (!aplicar) { console.log("\n(simulacao -- rode com --apply para gravar)"); process.exit(0); }

const backupDir = path.join(process.cwd(), "data", "pack-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const origem of [indicePath, unitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-channel-icons`));
}

await writeFile(unitPath, reconstruido.unitContent);
await writeFile(indicePath, encryptPackHeader(reconstruido.index));
console.log(`\ngravado. backup em data/pack-backups/*.${stamp}.before-channel-icons`);
