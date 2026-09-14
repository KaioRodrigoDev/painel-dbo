// Mostra os campos de uma skill do Table_Skill_Data.rdf, em texto.
//
// O RDF e 1 byte de cabecalho + registros de 348 bytes, um por skill. O tblidx e os
// 4 primeiros bytes do registro.
//
// Uso: node --experimental-strip-types scripts/ler-skill.ts <tblidx> [caminho-do-rdf]
import { readFile } from "node:fs/promises";
import path from "node:path";

const HEADER = 1, RECORD = 348;

const tblidx = Number(process.argv[2]);
if (!tblidx) { console.log("uso: ler-skill.ts <tblidx> [caminho-do-rdf]"); process.exit(1); }

const rdfPath = process.argv[3] ?? process.env.SKILL_TABLE_PATH ??
  path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");

const rdf = await readFile(rdfPath);
console.log(`arquivo: ${rdfPath}`);
console.log(`${((rdf.length - HEADER) / RECORD).toFixed(0)} skills, ${rdf.length} bytes\n`);

let off = -1;
for (let o = HEADER; o + RECORD <= rdf.length; o += RECORD) {
  if (rdf.readUInt32LE(o) === tblidx) { off = o; break; }
}
if (off < 0) { console.log(`tblidx ${tblidx} nao encontrado.`); process.exit(1); }

const texto = (ini: number, max: number) => {
  const fim = rdf.indexOf(0, off + ini);
  return rdf.toString("latin1", off + ini, Math.min(fim < 0 ? off + ini + max : fim, off + ini + max));
};

console.log(`registro no offset ${off} (skill #${(off - HEADER) / RECORD})\n`);
console.log(`  tblidx .............. ${rdf.readUInt32LE(off)}`);

console.log(`  icone ............... ${texto(218, 33)}`);


console.log("\n  bytes crus do registro (para conferir campo a campo):");
for (let i = 0; i < RECORD; i += 32) {
  const fatia = rdf.subarray(off + i, off + Math.min(i + 32, RECORD));
  console.log(`    ${String(i).padStart(3)}  ${fatia.toString("hex").replace(/(.{8})/g, "$1 ").trim()}`);
}
