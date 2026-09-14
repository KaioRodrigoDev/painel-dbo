// Lista os ícones das skills de uma árvore, com as dimensões reais lidas do tex.pak.
// Uso: node --experimental-strip-types scripts/inspect-tree-icons.ts [arquivo.scr]
import { readFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";
import { parseSkillLayout } from "../src/lib/skill-layout-format.ts";

const directory = process.env.CLIENT_PACK_DIRECTORY ?? process.env.ITEM_ICON_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const alvo = (process.argv[2] ?? ".\\gui\\skill\\hmy_transform.scr").toLowerCase();
const rdf = await readFile(process.env.SKILL_TABLE_PATH ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf"));

const guiIndex = decryptPackHeader(await readFile(path.join(directory, "gui.pak")));
const guiRec = scanIndexRecords(guiIndex).find((r) => r.name.toLowerCase() === alvo);
if (!guiRec) throw new Error(`${alvo} não está no índice gui.pak.`);
const guiUnit = await readFile(path.join(directory, `gui${guiRec.unit}.pak`));
const arvore = parseSkillLayout(guiUnit.subarray(guiRec.offset, guiRec.offset + guiRec.size).toString("latin1"));
const ids = arvore.cells.filter((c) => c.tblidx !== null).map((c) => c.tblidx as number).sort((a, b) => a - b);

function skillInfo(tblidx: number) {
  for (let o = 1; o + 348 <= rdf.length; o += 348) {
    if (rdf.readUInt32LE(o) !== tblidx) continue;
    const fim = rdf.indexOf(0, o + 218);
    return {
      icone: rdf.toString("latin1", o + 218, Math.min(fim < 0 ? o + 251 : fim, o + 251)).trim(),
      nome: rdf.toString("utf16le", o + 8, o + 90).split("\0")[0],
    };
  }
  return null;
}

const texIndex = decryptPackHeader(await readFile(path.join(directory, "tex.pak")));
const texRecs = scanIndexRecords(texIndex);
const unidades = new Map<number, Buffer>();

console.log(`${guiRec.name}: ${ids.length} skills\n`);
console.log("tblidx     ícone                            dimensão    nome");
console.log("-".repeat(92));
const resumo = new Map<string, number>();
for (const tblidx of ids) {
  const info = skillInfo(tblidx);
  if (!info) continue;
  const rec = texRecs.find((r) => path.win32.basename(r.name).toLowerCase() === info.icone.toLowerCase());
  let dim = info.icone ? "AUSENTE do pack" : "(sem ícone)";
  if (rec) {
    if (!unidades.has(rec.unit)) unidades.set(rec.unit, await readFile(path.join(directory, `tex${rec.unit}.pak`)));
    const b = unidades.get(rec.unit)!.subarray(rec.offset, rec.offset + rec.size);
    dim = b.readUInt32BE(0) === 0x89504e47 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : "não-PNG";
  }
  resumo.set(dim, (resumo.get(dim) ?? 0) + 1);
  console.log(`${String(tblidx).padEnd(10)} ${info.icone.padEnd(32)} ${dim.padEnd(11)} ${info.nome}`);
}
console.log("\nresumo: " + [...resumo].map(([k, n]) => `${k} x${n}`).join("   "));
