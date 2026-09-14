// Extrai o mesmo .scr de dois packs e mostra a diferenca linha a linha.
// Uso: node --experimental-strip-types scripts/diff-scr.ts <guiA.pak> <indiceA.pak> <guiB.pak> <indiceB.pak>
import { readFile } from "node:fs/promises";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const ALVO = ".\\gui\\skill\\hfi_skill.scr".toLowerCase();

async function extrai(indicePath: string, unitPath: string) {
  const index = decryptPackHeader(await readFile(indicePath));
  const record = scanIndexRecords(index).find((entry) => entry.name.toLowerCase() === ALVO);
  if (!record) throw new Error(`${ALVO} ausente de ${indicePath}`);
  const unit = await readFile(unitPath);
  return { texto: unit.subarray(record.offset, record.offset + record.size).toString("latin1"), record };
}

const [indiceA, unitA, indiceB, unitB] = process.argv.slice(2);
const a = await extrai(indiceA, unitA);
const b = await extrai(indiceB, unitB);

console.log(`A: ${a.record.size} bytes (offset ${a.record.offset})`);
console.log(`B: ${b.record.size} bytes (offset ${b.record.offset})\n`);

const la = a.texto.split("\r\n");
const lb = b.texto.split("\r\n");
console.log(`linhas: A=${la.length} B=${lb.length}\n`);

let mostradas = 0;
for (let i = 0, j = 0; i < la.length || j < lb.length; ) {
  if (la[i] === lb[j]) { i++; j++; continue; }
  // Bloco divergente: mostra ate as linhas voltarem a casar.
  const inicioA = i, inicioB = j;
  while (i < la.length && j < lb.length && la[i] !== lb[j]) { i++; j++; }
  console.log(`--- divergência a partir da linha ${inicioA + 1} ---`);
  for (let k = inicioA; k < i; k++) console.log(`  A: ${JSON.stringify(la[k])}`);
  for (let k = inicioB; k < j; k++) console.log(`  B: ${JSON.stringify(lb[k])}`);
  if (++mostradas >= 12) { console.log("... (mais divergências omitidas)"); break; }
}
if (!mostradas) console.log("nenhuma divergência linha a linha");
