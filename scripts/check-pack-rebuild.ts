// Exercita src/lib/pack-format.ts contra os packs reais, só em memória.
// Substitui um arquivo por outro de tamanho diferente e confere que TODOS os demais
// continuam legíveis e idênticos. Não escreve nada em disco.
// Uso: node --experimental-strip-types scripts/check-pack-rebuild.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";

const directory =
  process.env.CLIENT_PACK_DIRECTORY ??
  process.env.ITEM_ICON_PACK_DIRECTORY ??
  path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

const HEADER_FILE = "gui.pak";
const ALVO = ".\\gui\\skill\\hfi_skill.scr";

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const falhas: string[] = [];
const check = (ok: boolean, descricao: string) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${descricao}`);
  if (!ok) falhas.push(descricao);
};

const indexEncrypted = await readFile(path.join(directory, HEADER_FILE));
const index = decryptPackHeader(indexEncrypted);
const records = scanIndexRecords(index);
console.log(`índice ${HEADER_FILE}: ${records.length} registros nomeados`);

check(encryptPackHeader(index).equals(indexEncrypted), "cifra do índice é simétrica");

const alvo = records.find((record) => record.name.toLowerCase() === ALVO.toLowerCase());
if (!alvo) throw new Error(`${ALVO} não está no índice.`);
const unit = alvo.unit;
const unitContent = await readFile(path.join(directory, `${path.basename(HEADER_FILE, ".pak")}${unit}.pak`));
const daUnidade = records.filter((record) => record.unit === unit);
console.log(`unidade ${unit}: ${daUnidade.length} arquivos, ${unitContent.length} bytes\n`);

// Estado antes, para comparar depois.
const antes = new Map(daUnidade.map((record) => [record.name, sha(unitContent.subarray(record.offset, record.offset + record.size))]));

// Conteudo novo propositalmente maior, que e o caso que nao cabe na gravacao no lugar.
const original = unitContent.subarray(alvo.offset, alvo.offset + alvo.size);
const novo = Buffer.concat([original, Buffer.from("\r\n// linha de teste do rebuild\r\n", "latin1")]);
console.log(`substituindo ${alvo.name}: ${alvo.size} -> ${novo.length} bytes (+${novo.length - alvo.size})\n`);

const rebuilt = rebuildPackUnit({ index, records, unit, unitContent, replacements: new Map([[alvo.name, novo]]) });

console.log("verificações:");
check(rebuilt.unitContent.length === unitContent.length + (novo.length - alvo.size), "tamanho da unidade cresceu exatamente a diferença");
check(rebuilt.index.length === index.length, "índice manteve o tamanho");

// Registros de outras unidades nao podem ter sido tocados.
const outras = records.filter((record) => record.unit !== unit);
const outrasIntactas = outras.every((record) => {
  const offset = rebuilt.index.readUInt32LE(record.recordOffset + 136);
  const size = rebuilt.index.readUInt32LE(record.recordOffset + 132);
  return offset === record.offset && size === record.size;
});
check(outrasIntactas, `registros das outras unidades intactos (${outras.length})`);

// O teste que importa: reler tudo pelo indice novo e comparar com o estado anterior.
const novosRegistros = scanIndexRecords(rebuilt.index).filter((record) => record.unit === unit);
let iguais = 0;
let divergentes = 0;
for (const record of novosRegistros) {
  const relido = rebuilt.unitContent.subarray(record.offset, record.offset + record.size);
  if (relido.length !== record.size) { divergentes++; continue; }
  const esperado = record.name.toLowerCase() === ALVO.toLowerCase() ? sha(novo) : antes.get(record.name);
  if (sha(relido) === esperado) iguais++; else divergentes++;
}
check(divergentes === 0, `todos os ${novosRegistros.length} arquivos da unidade releem idênticos (${iguais} conferidos)`);

// E o arquivo substituido precisa sair com o conteudo novo.
const alvoNovo = novosRegistros.find((record) => record.name.toLowerCase() === ALVO.toLowerCase())!;
check(rebuilt.unitContent.subarray(alvoNovo.offset, alvoNovo.offset + alvoNovo.size).equals(novo), "arquivo substituído relê com o conteúdo novo");
check(encryptPackHeader(rebuilt.index).length === indexEncrypted.length, "índice novo cifra para o mesmo tamanho");

console.log(falhas.length ? `\nFALHOU em ${falhas.length} verificação(ões).` : "\nTodas as verificações passaram.");
process.exit(falhas.length ? 1 : 0);
