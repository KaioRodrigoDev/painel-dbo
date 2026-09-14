// Extrai um arquivo de dentro de um pack do cliente e imprime (ou grava) o conteudo.
// Uso: node --experimental-strip-types scripts/dump-srf.ts <trecho-do-nome> [--save <destino>]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const alvo = (process.argv[2] ?? "").toLowerCase();
const iSave = process.argv.indexOf("--save");
const destino = iSave > 0 ? process.argv[iSave + 1] : null;
if (!alvo) { console.log("uso: dump-srf.ts <trecho-do-nome> [--save <destino>]"); process.exit(1); }

const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

for (const header of ["gui.pak", "scr.pak", "tbl.pak"]) {
  const headerPath = path.join(directory, header);
  let index: Buffer;
  try { index = decryptPackHeader(await readFile(headerPath)); } catch { continue; }

  const records = scanIndexRecords(index);
  let achados = records.filter((r) => r.name.toLowerCase().includes(alvo));
  if (!achados.length) continue;

  // Se o nome bate exatamente com algum, e so ele. Sem isso, procurar por
  // "hfi_skill.scr" casaria tambem com "hfi_skill.scr.bak" -- e no modo --save o
  // ultimo sobrescreveria o primeiro, entregando o arquivo errado em silencio.
  const exatos = achados.filter((r) => path.win32.basename(r.name).toLowerCase() === alvo);
  if (exatos.length) achados = exatos;

  if (destino && achados.length > 1) {
    console.log(`"${alvo}" casa com ${achados.length} arquivos; use o nome exato:`);
    for (const r of achados) console.log(`  ${path.win32.basename(r.name)}`);
    process.exit(1);
  }

  const prefixo = path.basename(header, ".pak");
  for (const r of achados) {
    console.log(`${header}: ${r.name}  (unidade ${r.unit}, ${r.size} bytes)`);
    const unit = await readFile(path.join(directory, `${prefixo}${r.unit}.pak`));
    const conteudo = unit.subarray(r.offset, r.offset + r.size);

    if (destino) {
      await writeFile(destino, conteudo);
      console.log(`  gravado em ${destino}`);
    } else {
      console.log(conteudo.toString("latin1"));
    }
  }
  process.exit(0);
}

console.log(`nada encontrado com "${alvo}"`);
