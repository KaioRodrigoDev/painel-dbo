// Panorama dos packs do cliente: quantos arquivos, que tipos e quanto ocupam.
// Uso: node --experimental-strip-types scripts/pack-overview.ts
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const directory = process.env.CLIENT_PACK_DIRECTORY ?? process.env.ITEM_ICON_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

for (const header of ["gui.pak", "tbl.pak", "tex.pak", "scr.pak", "lang.pak"]) {
  const headerPath = path.join(directory, header);
  const st = await stat(headerPath).catch(() => null);
  if (!st) { console.log(`${header}: ausente\n`); continue; }

  const records = scanIndexRecords(decryptPackHeader(await readFile(headerPath)));
  const prefixo = path.basename(header, ".pak");

  // Unidades de dados e seus tamanhos
  const unidades = [...new Set(records.map((r) => r.unit))].sort((a, b) => a - b);
  let bytes = 0;
  for (const u of unidades) {
    const s = await stat(path.join(directory, `${prefixo}${u}.pak`)).catch(() => null);
    if (s) bytes += s.size;
  }

  // Extensoes mais comuns, para saber o que o pack guarda
  const ext = new Map<string, number>();
  for (const r of records) {
    const e = path.extname(r.name).toLowerCase() || "(sem)";
    ext.set(e, (ext.get(e) ?? 0) + 1);
  }
  const top = [...ext].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e, n]) => `${e} ${n}`).join(", ");

  console.log(`${header}`);
  console.log(`  índice: ${st.size.toLocaleString("pt-BR")} bytes, ${records.length.toLocaleString("pt-BR")} arquivos`);
  console.log(`  dados : ${unidades.map((u) => `${prefixo}${u}.pak`).join(", ")} — ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`  tipos : ${top}\n`);
}
