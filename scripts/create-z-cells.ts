// Cria a skill "Z Cells": 7 estágios encadeados, passiva, sem efeito, Místico humano.
// Só o grau 1 entra na árvore de transformação -- os demais vêm por upgrade, como o
// Kaioken (ver dwNextSkillTblidx em fill-transform-tree.ts).
//
// Escreve em dois lugares que precisam ficar em sincronia: o Table_Skill_Data.rdf do
// servidor e a cópia que o cliente lê de dentro do tbl2.pak. Faz backup dos dois antes e
// aborta sem tocar em nada se qualquer conferência falhar.
//
// Uso: node --experimental-strip-types scripts/create-z-cells.ts [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";
import { parseSkillLayout, serializeSkillLayout } from "../src/lib/skill-layout-format.ts";

const HEADER = 1, RECORD = 348;
const BASE = 2032200;                 // faixa livre: a 2032xxx vai ate 2032121
const ESTAGIOS = 7;
const NIVEL_INICIAL = 23;             // 23..29, um por estagio, como o Kaioken
const SP_POR_ESTAGIO = 1;
const NOME = "Z Cells";
const MODELO = 2032069;               // passiva do Mistico humano, usada como molde
const ARVORE = ".\\gui\\skill\\hmy_transform.scr";
const TABELA = ".\\data\\table_skill_data.rdf";

const aplicar = process.argv.includes("--apply");
const directory = process.env.CLIENT_PACK_DIRECTORY ?? process.env.ITEM_ICON_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const rdfPath = process.env.SKILL_TABLE_PATH ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");

const falhas: string[] = [];
const check = (ok: boolean, texto: string) => { console.log(`  ${ok ? "OK  " : "FALHA"} ${texto}`); if (!ok) falhas.push(texto); };
const acha = (buf: Buffer, tblidx: number) => {
  for (let o = HEADER; o + RECORD <= buf.length; o += RECORD) if (buf.readUInt32LE(o) === tblidx) return o;
  return -1;
};

const rdf = await readFile(rdfPath);
console.log(`RDF do servidor: ${rdf.length} bytes, ${(rdf.length - HEADER) / RECORD} registros`);

const molde = acha(rdf, MODELO);
if (molde < 0) throw new Error(`Molde ${MODELO} não encontrado.`);
for (let i = 0; i < ESTAGIOS; i += 1) {
  if (acha(rdf, BASE + i) >= 0) throw new Error(`TBLIDX ${BASE + i} já existe; escolha outra faixa.`);
}

/** Registro de um estágio, a partir do molde, com os campos que definem a skill. */
function registro(indice: number) {
  const r = Buffer.from(rdf.subarray(molde, molde + RECORD));
  const tblidx = BASE + indice;
  r.writeUInt32LE(tblidx, 0);                                   // tblidx
  r.writeUInt32LE(tblidx, 4);                                   // Skill_Name (id do texto)
  r.fill(0, 8, 90);
  Buffer.from(`${NOME} ${indice + 1}`, "utf16le").copy(r, 8);   // nome interno
  r.writeUInt8(1, 90);                                          // valido
  r.writeUInt32LE(0x00000002, 92);                              // classe: Mistico humano
  r.writeUInt8(indice + 1, 102);                                // grau
  r.writeUInt8(NIVEL_INICIAL + indice, 180);                    // nivel exigido
  r.writeUInt16LE(SP_POR_ESTAGIO, 190);                         // SP
  r.writeUInt32LE(0xffffffff, 116); r.writeUInt32LE(0xffffffff, 120);  // sem system effect
  r.writeUInt32LE(indice + 1 < ESTAGIOS ? tblidx + 1 : 0xffffffff, 304); // proximo estagio
  return r;
}

const novos = Array.from({ length: ESTAGIOS }, (_, i) => registro(i));
const rdfNovo = Buffer.concat([rdf, ...novos]);

console.log(`\nestágios:`);
for (let i = 0; i < ESTAGIOS; i += 1) {
  const o = acha(rdfNovo, BASE + i);
  console.log(`  ${BASE + i}  grau ${rdfNovo.readUInt8(o + 102)}  nível ${rdfNovo.readUInt8(o + 180)}  ${rdfNovo.readUInt16LE(o + 190)} SP  next ${rdfNovo.readUInt32LE(o + 304)}  "${rdfNovo.toString("utf16le", o + 8, o + 40).split("\0")[0]}"`);
}

console.log(`\nverificações do RDF:`);
check((rdfNovo.length - HEADER) % RECORD === 0, "o arquivo continua múltiplo do tamanho de registro");
check(rdfNovo.length === rdf.length + ESTAGIOS * RECORD, `cresceu exatamente ${ESTAGIOS} registros`);
check(rdfNovo.subarray(0, rdf.length).equals(rdf), "nenhum byte dos registros existentes mudou");
const cadeia = Array.from({ length: ESTAGIOS }, (_, i) => rdfNovo.readUInt32LE(acha(rdfNovo, BASE + i) + 304));
check(cadeia.slice(0, -1).every((next, i) => next === BASE + i + 1) && cadeia.at(-1) === 0xffffffff, "os 7 estágios estão encadeados e o último encerra");

// Cliente: a mesma tabela dentro do pack, mais o grau 1 na arvore de transformacao.
const indicePath = path.join(directory, "gui.pak");
const guiIndex = decryptPackHeader(await readFile(indicePath));
const guiRecords = scanIndexRecords(guiIndex);
const arvore = guiRecords.find((r) => r.name.toLowerCase() === ARVORE)!;
const guiUnitPath = path.join(directory, `gui${arvore.unit}.pak`);
const guiUnit = await readFile(guiUnitPath);

const layout = parseSkillLayout(guiUnit.subarray(arvore.offset, arvore.offset + arvore.size).toString("latin1"));
const livre = layout.cells.filter((c) => c.kind === "skill" && c.tblidx === null).sort((a, b) => a.column - b.column || a.row - b.row)[0];
if (!livre) throw new Error("Sem célula livre na árvore.");
const arvoreNova = Buffer.from(serializeSkillLayout(layout, new Map([[`${livre.column},${livre.row}`, BASE]])), "latin1");

const tblIndicePath = path.join(directory, "tbl.pak");
const tblIndex = decryptPackHeader(await readFile(tblIndicePath));
const tblRecords = scanIndexRecords(tblIndex);
const tabela = tblRecords.find((r) => r.name.toLowerCase() === TABELA)!;
const tblUnitPath = path.join(directory, `tbl${tabela.unit}.pak`);
const tblUnit = await readFile(tblUnitPath);
const tabelaAtual = tblUnit.subarray(tabela.offset, tabela.offset + tabela.size);

console.log(`\nverificações do cliente:`);
check(tabelaAtual.equals(rdf), "a tabela dentro do pack estava idêntica à do servidor");
check(parseSkillLayout(arvoreNova.toString("latin1")).cells.filter((c) => c.tblidx !== null).length === layout.cells.filter((c) => c.tblidx !== null).length + 1, `grau 1 acrescentado na árvore em (${livre.column},${livre.row})`);

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificação(ões); nada foi gravado.`); process.exit(1); }
if (!aplicar) { console.log("\n(simulação — rode com --apply para gravar)"); process.exit(0); }

const backupDir = path.join(process.cwd(), "data", "skill-rdf-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const origem of [rdfPath, indicePath, guiUnitPath, tblIndicePath, tblUnitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-z-cells`));
}

const gui = rebuildPackUnit({ index: guiIndex, records: guiRecords, unit: arvore.unit, unitContent: guiUnit, replacements: new Map([[arvore.name, arvoreNova]]) });
await writeFile(guiUnitPath, gui.unitContent);
await writeFile(indicePath, encryptPackHeader(gui.index));

const tbl = rebuildPackUnit({ index: tblIndex, records: tblRecords, unit: tabela.unit, unitContent: tblUnit, replacements: new Map([[tabela.name, rdfNovo]]) });
await writeFile(tblUnitPath, tbl.unitContent);
await writeFile(tblIndicePath, encryptPackHeader(tbl.index));

await writeFile(rdfPath, rdfNovo);
console.log(`\ngravado (servidor + cliente). backup em data/skill-rdf-backups/*.${stamp}.before-z-cells`);
