// Acrescenta a superficie "srfVipIcon" aos dois .srf que desenham a lista de canais,
// para o canal VIP poder ter uma marca propria em vez de repetir a do Scramble.
//
// A regiao apontada e a marca de Zenny que ja existe na textura rsrRaceCommon (a mesma
// textura que o icone do Scramble usa), entao nao entra imagem nova no pack -- so uma
// definicao de recorte. Os dois arquivos referenciam rsrRaceCommon por pacotes
// diferentes: Game.rsr dentro do jogo, Lobby.rsr na tela de selecao.
//
// Uso: node --experimental-strip-types scripts/add-vip-icon-surface.ts [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";

const aplicar = process.argv.includes("--apply");
const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

const SUPERFICIE = "srfVipIcon";
// recorte da marca de Zenny dentro de rsrRaceCommon
const UV = { left: 493, top: 113, right: 509, bottom: 129 };

const alvos = [
  { arquivo: ".\\gui\\channelchange.srf", resource: "Game.rsr" },
  { arquivo: ".\\gui\\charchannelselect.srf", resource: "Lobby.rsr" },
];

const bloco = (resourceFile: string) =>
  [
    "",
    `surface "${SUPERFICIE}"`,
    "{",
    `\tresource_file\t= "${resourceFile}";`,
    '\tresource_name\t= "rsrRaceCommon";',
    "",
    "\tx\t\t= 0;",
    "\ty\t\t= 0;",
    `\twidth\t\t= ${UV.right - UV.left};`,
    `\theight\t\t= ${UV.bottom - UV.top};`,
    "",
    "\tcolor_red\t= 255;",
    "\tcolor_green\t= 255;",
    "\tcolor_blue\t= 255;",
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
  const r = records.find((x) => x.name.toLowerCase() === alvo.arquivo.toLowerCase());
  check(!!r, `achou ${alvo.arquivo}`);
  if (!r) continue;
  check(r.unit === unidade, `${alvo.arquivo} esta na mesma unidade`);

  const texto = unitContent.subarray(r.offset, r.offset + r.size).toString("latin1");
  check(!texto.includes(SUPERFICIE), `${alvo.arquivo} ainda nao tem ${SUPERFICIE}`);
  check(texto.includes("srfDBSSmallIcon"), `${alvo.arquivo} tem o icone de evento (molde esperado)`);

  substituicoes.set(r.name, Buffer.from(texto.replace(/\s*$/, "\r\n") + bloco(alvo.resource), "latin1"));
}

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificacao(oes); nada gravado.`); process.exit(1); }

const antes = new Map(records.map((r) => [r.name, `${r.unit}:${r.size}`]));
const reconstruido = rebuildPackUnit({ index, records, unit: unidade!, unitContent, replacements: substituicoes });
const novosRecords = scanIndexRecords(reconstruido.index);

console.log("\nverificacoes:");
check(novosRecords.length === records.length, `a contagem de arquivos nao mudou (${novosRecords.length})`);
const intactos = [...antes].filter(([nome]) => !substituicoes.has(nome)).every(([nome, chave]) => {
  const r = novosRecords.find((x) => x.name === nome);
  return r && `${r.unit}:${r.size}` === chave;
});
check(intactos, "os outros arquivos do pack mantiveram unidade e tamanho");

for (const [nome, conteudo] of substituicoes) {
  const r = novosRecords.find((x) => x.name === nome)!;
  const lido = reconstruido.unitContent.subarray(r.offset, r.offset + r.size);
  check(lido.equals(conteudo), `${nome} rele identico pelo indice`);
  check(lido.toString("latin1").includes(`surface "${SUPERFICIE}"`), `${nome} contem ${SUPERFICIE}`);
}

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificacao(oes); nada gravado.`); process.exit(1); }
if (!aplicar) { console.log("\n(simulacao -- rode com --apply para gravar)"); process.exit(0); }

const backupDir = path.join(process.cwd(), "data", "pack-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const origem of [indicePath, unitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-vip-icon`));
}

await writeFile(unitPath, reconstruido.unitContent);
await writeFile(indicePath, encryptPackHeader(reconstruido.index));
console.log(`\ngravado. backup em data/pack-backups/*.${stamp}.before-vip-icon`);
