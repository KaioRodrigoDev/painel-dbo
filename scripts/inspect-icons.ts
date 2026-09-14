// Inspeciona os ícones de skill dentro do tex.pak: caminho, formato e dimensões.
// Uso: node --experimental-strip-types scripts/inspect-icons.ts [filtro]
import { readFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const directory =
  process.env.CLIENT_PACK_DIRECTORY ??
  process.env.ITEM_ICON_PACK_DIRECTORY ??
  path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const filtro = (process.argv[2] ?? "").toLowerCase();

const index = decryptPackHeader(await readFile(path.join(directory, "tex.pak")));
const records = scanIndexRecords(index);

const icones = records.filter((r) => r.name.toLowerCase().includes("\\icon\\"));
console.log(`tex.pak: ${records.length} arquivos, ${icones.length} sob \\icon\\\n`);

// Pastas usadas, para saber onde um icone novo deve entrar.
const pastas = new Map<string, number>();
for (const r of icones) {
  const pasta = r.name.slice(0, r.name.lastIndexOf("\\") + 1);
  pastas.set(pasta, (pastas.get(pasta) ?? 0) + 1);
}
console.log("pastas:");
for (const [pasta, n] of [...pastas].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${pasta}`);

// Extensoes
const ext = new Map<string, number>();
for (const r of icones) {
  const e = path.extname(r.name).toLowerCase();
  ext.set(e, (ext.get(e) ?? 0) + 1);
}
console.log("\nextensões: " + [...ext].map(([e, n]) => `${e} x${n}`).join("  "));

/** Largura/altura a partir do cabeçalho do arquivo. */
function dimensoes(buf: Buffer) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { formato: "PNG", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 20 && buf.toString("latin1", 0, 4) === "DDS ") {
    return { formato: "DDS", w: buf.readUInt32LE(16), h: buf.readUInt32LE(12) };
  }
  if (buf.length > 6 && buf.toString("latin1", 0, 2) === "BM") return { formato: "BMP", w: buf.readInt32LE(18), h: buf.readInt32LE(22) };
  return { formato: "?", w: 0, h: 0 };
}

const alvos = icones.filter((r) => !filtro || r.name.toLowerCase().includes(filtro)).slice(0, 12);
console.log(`\namostra (${alvos.length}):`);
const unidades = new Map<number, Buffer>();
const tamanhos = new Map<string, number>();
for (const r of alvos) {
  if (!unidades.has(r.unit)) unidades.set(r.unit, await readFile(path.join(directory, `tex${r.unit}.pak`)));
  const buf = unidades.get(r.unit)!.subarray(r.offset, r.offset + r.size);
  const d = dimensoes(buf);
  const chave = `${d.formato} ${d.w}x${d.h}`;
  tamanhos.set(chave, (tamanhos.get(chave) ?? 0) + 1);
  console.log(`  ${String(r.size).padStart(7)} b  ${chave.padEnd(14)}  ${r.name}`);
}
console.log("\nformatos vistos na amostra: " + [...tamanhos].map(([k, n]) => `${k} x${n}`).join("  "));
