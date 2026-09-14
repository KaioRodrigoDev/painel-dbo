// Corrige os 7 registros da Z Cells, que eu criei com skill_Effect inválido.
//
// O servidor exige pelo menos um system effect válido: CSkill::Create faz
// FindData(skill_Effect[j]) e, se nenhum resolver, chama Destroy() e devolve false. Pior,
// CSkillManagerPc::LearnSkill chama OnLearnSkill() no objeto mesmo quando Create falha --
// por isso "sem efeito" derrubava o GameServer em vez de só recusar.
//
// A correção: refazer os registros a partir de 120021 (uma passiva real do Místico
// humano, grau 1) e zerar o VALOR do efeito. O efeito existe, então Create passa; o valor
// é 0, então não há bônus -- que é o comportamento pedido.
//
// Uso: node --experimental-strip-types scripts/fix-z-cells.ts [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";

const HEADER = 1, RECORD = 348;
const BASE = 2032200, ESTAGIOS = 7;
const NIVEL_INICIAL = 23, SP_POR_ESTAGIO = 1;
const NOME = "Z Cells";
const MODELO = 120021;                // passiva do Mistico humano, grau 1
const TABELA = ".\\data\\table_skill_data.rdf";

const aplicar = process.argv.includes("--apply");
const directory = process.env.CLIENT_PACK_DIRECTORY ?? process.env.ITEM_ICON_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const rdfPath = process.env.SKILL_TABLE_PATH ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");
const efeitosPath = path.join(path.dirname(rdfPath), "Table_System_Effect_Data.rdf");

const falhas: string[] = [];
const check = (ok: boolean, texto: string) => { console.log(`  ${ok ? "OK  " : "FALHA"} ${texto}`); if (!ok) falhas.push(texto); };
const acha = (buf: Buffer, tblidx: number) => {
  for (let o = HEADER; o + RECORD <= buf.length; o += RECORD) if (buf.readUInt32LE(o) === tblidx) return o;
  return -1;
};

const rdf = Buffer.from(await readFile(rdfPath));
const efeitos = await readFile(efeitosPath);
const efeitoExiste = (id: number) => {
  for (let o = 1; o + 172 <= efeitos.length; o += 172) if (efeitos.readUInt32LE(o) === id) return true;
  return false;
};

const molde = acha(rdf, MODELO);
if (molde < 0) throw new Error(`Molde ${MODELO} não encontrado.`);
const efeitoDoMolde = rdf.readUInt32LE(molde + 116);
console.log(`molde ${MODELO}: skill_Effect[0] = ${efeitoDoMolde}, tipo ${rdf.readUInt8(molde + 98)}/${rdf.readUInt8(molde + 99)}`);
check(efeitoExiste(efeitoDoMolde), `o efeito ${efeitoDoMolde} existe na Table_System_Effect_Data`);

for (let i = 0; i < ESTAGIOS; i += 1) {
  const tblidx = BASE + i;
  const destino = acha(rdf, tblidx);
  if (destino < 0) throw new Error(`${tblidx} não existe; rode create-z-cells.ts antes.`);

  const r = Buffer.from(rdf.subarray(molde, molde + RECORD));
  r.writeUInt32LE(tblidx, 0);
  r.writeUInt32LE(tblidx, 4);
  r.fill(0, 8, 90);
  Buffer.from(`${NOME} ${i + 1}`, "utf16le").copy(r, 8);
  r.writeUInt8(1, 90);
  r.writeUInt32LE(0x00000002, 92);                                  // Mistico humano
  r.writeUInt8(i + 1, 102);                                         // grau
  r.writeDoubleLE(0, 128);                                          // valor do efeito = sem bonus
  r.writeUInt8(NIVEL_INICIAL + i, 180);
  r.writeUInt16LE(SP_POR_ESTAGIO, 190);
  r.writeUInt32LE(i + 1 < ESTAGIOS ? tblidx + 1 : 0xffffffff, 304); // proximo estagio
  r.copy(rdf, destino);
}

console.log(`\nestágios corrigidos:`);
for (let i = 0; i < ESTAGIOS; i += 1) {
  const o = acha(rdf, BASE + i);
  console.log(`  ${BASE + i}  grau ${rdf.readUInt8(o + 102)}  nível ${rdf.readUInt8(o + 180)}  efeito ${rdf.readUInt32LE(o + 116)} valor ${rdf.readDoubleLE(o + 128)}  next ${rdf.readUInt32LE(o + 304)}`);
}

console.log(`\nverificações:`);
const todos = Array.from({ length: ESTAGIOS }, (_, i) => acha(rdf, BASE + i));
check(todos.every((o) => efeitoExiste(rdf.readUInt32LE(o + 116))), "todo estágio tem system effect que resolve (CSkill::Create passa)");
check(todos.every((o) => rdf.readDoubleLE(o + 128) === 0), "valor do efeito zerado em todos: sem bônus");
check(todos.every((o) => rdf.readUInt32LE(o + 92) === 2), "classe Místico humano em todos");
const cadeia = todos.map((o) => rdf.readUInt32LE(o + 304));
check(cadeia.slice(0, -1).every((n, i) => n === BASE + i + 1) && cadeia.at(-1) === 0xffffffff, "os 7 continuam encadeados");

// Cliente
const tblIndicePath = path.join(directory, "tbl.pak");
const tblIndex = decryptPackHeader(await readFile(tblIndicePath));
const tblRecords = scanIndexRecords(tblIndex);
const tabela = tblRecords.find((r) => r.name.toLowerCase() === TABELA)!;
const tblUnitPath = path.join(directory, `tbl${tabela.unit}.pak`);
const tblUnit = await readFile(tblUnitPath);
check(tblUnit.subarray(tabela.offset, tabela.offset + tabela.size).length === rdf.length, "a cópia do cliente tem o mesmo tamanho da do servidor");

if (falhas.length) { console.log(`\nFALHOU em ${falhas.length} verificação(ões); nada gravado.`); process.exit(1); }
if (!aplicar) { console.log("\n(simulação — rode com --apply para gravar)"); process.exit(0); }

const backupDir = path.join(process.cwd(), "data", "skill-rdf-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const origem of [rdfPath, tblIndicePath, tblUnitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-fix-z-cells`));
}
const tbl = rebuildPackUnit({ index: tblIndex, records: tblRecords, unit: tabela.unit, unitContent: tblUnit, replacements: new Map([[tabela.name, rdf]]) });
await writeFile(tblUnitPath, tbl.unitContent);
await writeFile(tblIndicePath, encryptPackHeader(tbl.index));
await writeFile(rdfPath, rdf);
console.log(`\ngravado (servidor + cliente). backup em data/skill-rdf-backups/*.${stamp}.before-fix-z-cells`);
