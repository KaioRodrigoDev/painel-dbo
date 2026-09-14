// Acrescenta um ícone ao tex.pak e aponta skills para ele.
//
// O nome do ícone fica no registro da skill (offset 218, 33 bytes) e é resolvido pelo
// cliente em .\texture\gui\icon\. Precisa existir nas duas cópias da tabela de skill --
// a do servidor e a de dentro do tbl.pak -- senão o painel e o jogo divergem.
//
// Uso: node --experimental-strip-types scripts/add-skill-icon.ts <arquivo.png> <tblidx,tblidx,...> [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { appendPackFile, decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";
import { lerPNG } from "./png-tools.ts";

const HEADER = 1, RECORD = 348, ICON_OFFSET = 218, ICON_MAX = 33;
const PASTA_ICONES = ".\\texture\\gui\\icon\\";
const TABELA = ".\\data\\table_skill_data.rdf";

const [, , arquivo, listaIds] = process.argv;
const aplicar = process.argv.includes("--apply");
if (!arquivo || !listaIds) { console.log("uso: add-skill-icon.ts <arquivo.png> <tblidx,tblidx,...> [--apply]"); process.exit(1); }
const ids = listaIds.split(",").map((s) => Number(s.trim())).filter(Boolean);

const directory = process.env.CLIENT_PACK_DIRECTORY ?? process.env.ITEM_ICON_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const rdfPath = process.env.SKILL_TABLE_PATH ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");

const falhas: string[] = [];
const check = (ok: boolean, t: string) => { console.log(`  ${ok ? "OK  " : "FALHA"} ${t}`); if (!ok) falhas.push(t); };

const nomeIcone = path.basename(arquivo).toLowerCase();
const conteudo = await readFile(arquivo);
const img = lerPNG(conteudo);

console.log(`ícone: ${nomeIcone} — ${img.largura}x${img.altura}, ${conteudo.length} bytes`);
check(nomeIcone.length < ICON_MAX, `o nome cabe no registro (${nomeIcone.length} de ${ICON_MAX - 1} caracteres)`);
check(img.largura === 32 && img.altura === 32, "32x32, como o cliente recorta");
let opacos = 0;
for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i] > 0) opacos += 1;
check(opacos < img.largura * img.altura, `tem transparência (${img.largura * img.altura - opacos} px recortados)`);

// tex.pak: inclui o arquivo
const texIndicePath = path.join(directory, "tex.pak");
let texIndex = decryptPackHeader(await readFile(texIndicePath));
let texRecords = scanIndexRecords(texIndex);
const jaExiste = texRecords.find((r) => path.win32.basename(r.name).toLowerCase() === nomeIcone);
check(!jaExiste, jaExiste ? `NOME EM USO por ${jaExiste.name}` : "o nome está livre no tex.pak");

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificação(ões); nada gravado.`); process.exit(1); }

// A unidade que recebe: a mesma dos outros icones, para nao espalhar.
const unidadeIcones = texRecords.filter((r) => r.name.toLowerCase().startsWith(PASTA_ICONES))[0].unit;
const texUnitPath = path.join(directory, `tex${unidadeIcones}.pak`);
const texUnit = await readFile(texUnitPath);
const antesTex = new Map(texRecords.map((r) => [r.name, `${r.unit}:${r.offset}:${r.size}`]));

const inclusao = appendPackFile({ index: texIndex, records: texRecords, unit: unidadeIcones, unitContent: texUnit, name: PASTA_ICONES + nomeIcone, content: conteudo });
texIndex = inclusao.index;
const texUnitNovo = inclusao.unitContent;
texRecords = scanIndexRecords(texIndex);

// Tabela de skill: aponta os registros para o icone novo
const rdf = Buffer.from(await readFile(rdfPath));
const acha = (t: number) => { for (let o = HEADER; o + RECORD <= rdf.length; o += RECORD) if (rdf.readUInt32LE(o) === t) return o; return -1; };
console.log("\nskills:");
for (const t of ids) {
  const o = acha(t);
  if (o < 0) { console.log(`  FALHA ${t} não existe no RDF`); falhas.push(`${t} ausente`); continue; }
  const fim = rdf.indexOf(0, o + ICON_OFFSET);
  const antes = rdf.toString("latin1", o + ICON_OFFSET, Math.min(fim < 0 ? o + ICON_OFFSET + ICON_MAX : fim, o + ICON_OFFSET + ICON_MAX));
  rdf.fill(0, o + ICON_OFFSET, o + ICON_OFFSET + ICON_MAX);
  Buffer.from(nomeIcone, "latin1").copy(rdf, o + ICON_OFFSET);
  console.log(`  ${t}  ${antes.padEnd(24)} -> ${nomeIcone}`);
}

console.log("\nverificações:");
const intactos = [...antesTex].every(([nome, chave]) => {
  const r = texRecords.find((x) => x.name === nome);
  return r && `${r.unit}:${r.offset}:${r.size}` === chave;
});
check(intactos, `os ${antesTex.size} arquivos do tex.pak mantiveram unidade, offset e tamanho`);
const criado = texRecords.find((r) => r.name === PASTA_ICONES + nomeIcone)!;
check(texUnitNovo.subarray(criado.offset, criado.offset + criado.size).equals(conteudo), "o ícone relê idêntico pelo índice");
check(ids.every((t) => { const o = acha(t); return rdf.toString("latin1", o + ICON_OFFSET, o + ICON_OFFSET + nomeIcone.length) === nomeIcone; }), "todas as skills apontam para o ícone novo");

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificação(ões); nada gravado.`); process.exit(1); }
if (!aplicar) { console.log("\n(simulação — rode com --apply para gravar)"); process.exit(0); }

const backupDir = path.join(process.cwd(), "data", "skill-rdf-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const tblIndicePath = path.join(directory, "tbl.pak");
const tblIndex = decryptPackHeader(await readFile(tblIndicePath));
const tblRecords = scanIndexRecords(tblIndex);
const tabela = tblRecords.find((r) => r.name.toLowerCase() === TABELA)!;
const tblUnitPath = path.join(directory, `tbl${tabela.unit}.pak`);
const tblUnit = await readFile(tblUnitPath);

for (const origem of [rdfPath, texIndicePath, texUnitPath, tblIndicePath, tblUnitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-icon`));
}
await writeFile(texUnitPath, texUnitNovo);
await writeFile(texIndicePath, encryptPackHeader(texIndex));

const tbl = rebuildPackUnit({ index: tblIndex, records: tblRecords, unit: tabela.unit, unitContent: tblUnit, replacements: new Map([[tabela.name, rdf]]) });
await writeFile(tblUnitPath, tbl.unitContent);
await writeFile(tblIndicePath, encryptPackHeader(tbl.index));
await writeFile(rdfPath, rdf);
console.log(`\ngravado. backup em data/skill-rdf-backups/*.${stamp}.before-icon`);
