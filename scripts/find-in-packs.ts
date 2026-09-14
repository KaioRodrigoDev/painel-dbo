// Lista todos os arquivos de todos os packs cujo nome contem um trecho.
// Uso: node --experimental-strip-types scripts/find-in-packs.ts <trecho>
import { readFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const alvo = (process.argv[2] ?? "").toLowerCase();
if (!alvo) { console.log("uso: find-in-packs.ts <trecho>"); process.exit(1); }

const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

// todos os .pak de indice: os que nao terminam em digito antes da extensao
const { readdir } = await import("node:fs/promises");
const arquivos = (await readdir(directory)).filter((f) => /^[a-z_]+\.pak$/i.test(f));

for (const header of arquivos.sort()) {
  let records;
  try {
    records = scanIndexRecords(decryptPackHeader(await readFile(path.join(directory, header))));
  } catch { continue; }

  for (const r of records) {
    if (!r.name.toLowerCase().includes(alvo)) continue;
    const prefixo = path.basename(header, ".pak");
    console.log(`${header.padEnd(10)} ${`${prefixo}${r.unit}.pak`.padEnd(12)} ${String(r.size).padStart(9)} bytes  ${r.name}`);
  }
}
