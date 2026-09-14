// Procura superficies pequenas (candidatas a icone) nos .srf do gui.pak.
// Uso: node --experimental-strip-types scripts/find-surfaces.ts <palavra> [<palavra>...]
import { readFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const palavras = process.argv.slice(2).map((s) => s.toLowerCase());
if (!palavras.length) { console.log("uso: find-surfaces.ts <palavra> [...]"); process.exit(1); }

const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const index = decryptPackHeader(await readFile(path.join(directory, "gui.pak")));
const records = scanIndexRecords(index);
const unidades = new Map<number, Buffer>();

for (const r of records.filter((x) => x.name.toLowerCase().endsWith(".srf"))) {
  if (!unidades.has(r.unit)) unidades.set(r.unit, await readFile(path.join(directory, `gui${r.unit}.pak`)));
  const texto = unidades.get(r.unit)!.subarray(r.offset, r.offset + r.size).toString("latin1");

  // um bloco por superficie
  const blocos = texto.split(/surface\s+"/).slice(1);
  for (const bloco of blocos) {
    const nome = bloco.slice(0, bloco.indexOf('"'));
    if (!palavras.some((p) => nome.toLowerCase().includes(p))) continue;

    const num = (campo: string) => {
      const m = bloco.match(new RegExp(`${campo}\\s*=\\s*(\\d+)`));
      return m ? Number(m[1]) : 0;
    };
    const larg = num("uv_right") - num("uv_left");
    const alt = num("uv_bottom") - num("uv_top");
    const res = bloco.match(/resource_name\s*=\s*"([^"]+)"/)?.[1] ?? "?";

    // so o que tem cara de icone
    if (larg > 0 && larg <= 40 && alt > 0 && alt <= 40) {
      console.log(`${path.win32.basename(r.name).padEnd(26)} ${nome.padEnd(28)} ${String(larg)}x${alt}  ${res}  uv ${num("uv_left")},${num("uv_top")}`);
    }
  }
}
