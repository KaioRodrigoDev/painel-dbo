// Acrescenta as variacoes coloridas da marca de VIP aos .srf da lista de canais.
//
// Nao entra imagem nova no pack: a superficie aponta para a MESMA regiao da textura
// que a srfVipIcon usa, mudando so color_red/green/blue. O cliente joga essas cores
// nos vertices (RwIm2DVertexSetIntRGBA em gui_renderer.cpp), entao elas modulam a
// textura -- e o mesmo mecanismo que os botoes usam para escurecer/clarear.
//
// A cor fica no .srf de proposito: mudar o tom depois e editar tres numeros e
// reempacotar, sem recompilar cliente.
//
// Uso: node --experimental-strip-types scripts/add-vip-icon-colors.ts [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";

const aplicar = process.argv.includes("--apply");
const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

// mesma regiao da srfVipIcon (marca de Zenny na rsrRaceCommon)
const UV = { left: 493, top: 113, right: 509, bottom: 129 };

// nivel -> cor. O nivel 1 continua com a srfVipIcon, sem tingimento.
const VARIACOES = [
  { nivel: 2, cor: { r: 255, g: 48, b: 48 }, descricao: "vermelho" },
  { nivel: 3, cor: { r: 120, g: 140, b: 255 }, descricao: "azul" },
];

const alvos = [
  { arquivo: ".\\gui\\channelchange.srf", resource: "Game.rsr" },
  { arquivo: ".\\gui\\charchannelselect.srf", resource: "Lobby.rsr" },
];

const bloco = (nome: string, resourceFile: string, cor: { r: number; g: number; b: number }) =>
  [
    "",
    `surface "${nome}"`,
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

const unidade = records.find((r) => r.name.toLowerCase() === alvos[0].arquivo.toLowerCase())?.unit;
check(unidade !== undefined, "os .srf da lista de canais estao no gui.pak");
if (falhas.length) process.exit(1);

const unitPath = path.join(directory, `gui${unidade}.pak`);
const unitContent = await readFile(unitPath);

const substituicoes = new Map<string, Buffer>();
for (const alvo of alvos) {
  const r = records.find((x) => x.name.toLowerCase() === alvo.arquivo.toLowerCase())!;
  let texto = unitContent.subarray(r.offset, r.offset + r.size).toString("latin1");

  check(texto.includes('surface "srfVipIcon"'), `${alvo.arquivo} ja tem a srfVipIcon (nivel 1)`);

  for (const v of VARIACOES) {
    const nome = `srfVipIcon${v.nivel}`;
    check(!texto.includes(`surface "${nome}"`), `${alvo.arquivo} ainda nao tem ${nome}`);
    texto = texto.replace(/\s*$/, "\r\n") + bloco(nome, alvo.resource, v.cor);
  }

  substituicoes.set(r.name, Buffer.from(texto, "latin1"));
}

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificacao(oes); nada gravado.`); process.exit(1); }

const antes = new Map(records.map((r) => [r.name, `${r.unit}:${r.size}`]));
const reconstruido = rebuildPackUnit({ index, records, unit: unidade!, unitContent, replacements: substituicoes });
const novos = scanIndexRecords(reconstruido.index);

console.log("\nverificacoes:");
check(novos.length === records.length, `a contagem de arquivos nao mudou (${novos.length})`);
check(
  [...antes].filter(([n]) => !substituicoes.has(n)).every(([n, chave]) => {
    const r = novos.find((x) => x.name === n);
    return r && `${r.unit}:${r.size}` === chave;
  }),
  "os outros arquivos do pack mantiveram unidade e tamanho",
);

for (const [nome, conteudo] of substituicoes) {
  const r = novos.find((x) => x.name === nome)!;
  const lido = reconstruido.unitContent.subarray(r.offset, r.offset + r.size);
  check(lido.equals(conteudo), `${nome} rele identico pelo indice`);
  for (const v of VARIACOES) {
    check(lido.toString("latin1").includes(`surface "srfVipIcon${v.nivel}"`), `${nome} contem srfVipIcon${v.nivel} (${v.descricao})`);
  }
}

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificacao(oes); nada gravado.`); process.exit(1); }
if (!aplicar) { console.log("\n(simulacao -- rode com --apply para gravar)"); process.exit(0); }

const backupDir = path.join(process.cwd(), "data", "pack-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const origem of [indicePath, unitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-vip-colors`));
}

await writeFile(unitPath, reconstruido.unitContent);
await writeFile(indicePath, encryptPackHeader(reconstruido.index));
console.log(`\ngravado. backup em data/pack-backups/*.${stamp}.before-vip-colors`);
