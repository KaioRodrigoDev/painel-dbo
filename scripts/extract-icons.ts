// Extrai ícones do tex.pak para uma pasta, para abrir num editor de imagem.
// Uso: node --experimental-strip-types scripts/extract-icons.ts <filtro> [destino]
//   filtro   trecho do nome do arquivo (ex.: "ssjblue", "hum_skl_ast", "" para todos)
//   destino  padrão: ../icones-extraidos
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const directory = process.env.CLIENT_PACK_DIRECTORY ?? process.env.ITEM_ICON_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const filtro = (process.argv[2] ?? "").toLowerCase();
const destino = path.resolve(process.argv[3] ?? path.resolve(process.cwd(), "..", "icones-extraidos"));

const index = decryptPackHeader(await readFile(path.join(directory, "tex.pak")));
const alvos = scanIndexRecords(index).filter(
  (r) => r.name.toLowerCase().includes("\\icon\\") && path.win32.basename(r.name).toLowerCase().includes(filtro),
);
if (!alvos.length) { console.log(`Nenhum ícone com "${filtro}".`); process.exit(1); }
if (alvos.length > 400) { console.log(`${alvos.length} ícones casam com "${filtro}" — refine o filtro.`); process.exit(1); }

await mkdir(destino, { recursive: true });
const unidades = new Map<number, Buffer>();
console.log(`extraindo ${alvos.length} para ${destino}\n`);

for (const r of alvos) {
  if (!unidades.has(r.unit)) unidades.set(r.unit, await readFile(path.join(directory, `tex${r.unit}.pak`)));
  const b = unidades.get(r.unit)!.subarray(r.offset, r.offset + r.size);
  const nome = path.win32.basename(r.name);
  await writeFile(path.join(destino, nome), b);
  const dim = b.readUInt32BE(0) === 0x89504e47 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : "não-PNG";
  console.log(`  ${nome.padEnd(32)} ${dim.padEnd(9)} ${r.size} b`);
}
console.log(`\npronto: ${destino}`);
