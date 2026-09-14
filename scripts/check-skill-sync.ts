// Confere se a tabela de skill do servidor e a copia de dentro do pack do cliente
// estao identicas.
//
// Divergencia entre as duas nao da erro em lugar nenhum -- da comportamento estranho
// e dificil de rastrear, porque o cliente monta a lista de alvos e o servidor so
// valida. Vale rodar antes de empacotar as mudancas para outra pessoa.
//
// Uso: node --experimental-strip-types scripts/check-skill-sync.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";

const HEADER = 1, RECORD = 348;
const INTERNO = ".\\data\\table_skill_data.rdf";

const directory = process.env.CLIENT_PACK_DIRECTORY ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const rdfPath = process.env.SKILL_TABLE_PATH ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");

const servidor = await readFile(rdfPath);

const index = decryptPackHeader(await readFile(path.join(directory, "tbl.pak")));
const registro = scanIndexRecords(index).find((r) => r.name.toLowerCase() === INTERNO.toLowerCase());
if (!registro) { console.log(`nao achei ${INTERNO} no tbl.pak`); process.exit(1); }

const unit = await readFile(path.join(directory, `tbl${registro.unit}.pak`));
const cliente = unit.subarray(registro.offset, registro.offset + registro.size);

const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex").slice(0, 16);

console.log(`servidor  ${servidor.length.toLocaleString("pt-BR").padStart(11)} bytes  ${md5(servidor)}`);
console.log(`cliente   ${cliente.length.toLocaleString("pt-BR").padStart(11)} bytes  ${md5(Buffer.from(cliente))}  (tbl${registro.unit}.pak)`);
console.log();

if (servidor.equals(cliente)) {
  console.log("IGUAIS -- as duas copias batem byte a byte.");
  console.log(`${((servidor.length - HEADER) / RECORD).toFixed(0)} skills.`);
  process.exit(0);
}

console.log("DIFEREM. O jogo vai se comportar de forma estranha.\n");

if (servidor.length !== cliente.length) {
  const a = (servidor.length - HEADER) / RECORD, b = (cliente.length - HEADER) / RECORD;
  console.log(`  quantidade de skills: servidor ${a.toFixed(0)}, cliente ${b.toFixed(0)}`);
  console.log("  Tamanhos diferentes -- uma das copias tem skill que a outra nao tem.\n");
}

// quais tblidx divergem
const lerTodos = (buf: Buffer) => {
  const m = new Map<number, Buffer>();
  for (let o = HEADER; o + RECORD <= buf.length; o += RECORD) m.set(buf.readUInt32LE(o), buf.subarray(o, o + RECORD));
  return m;
};
const mapaS = lerTodos(servidor), mapaC = lerTodos(Buffer.from(cliente));

const soServidor: number[] = [], soCliente: number[] = [], diferentes: number[] = [];
for (const [t, reg] of mapaS) {
  const outro = mapaC.get(t);
  if (!outro) soServidor.push(t);
  else if (!reg.equals(outro)) diferentes.push(t);
}
for (const t of mapaC.keys()) if (!mapaS.has(t)) soCliente.push(t);

const mostra = (rotulo: string, lista: number[]) => {
  if (!lista.length) return;
  console.log(`  ${rotulo} (${lista.length}): ${lista.slice(0, 20).join(", ")}${lista.length > 20 ? ", ..." : ""}`);
};
mostra("so no servidor", soServidor);
mostra("so no cliente", soCliente);
mostra("conteudo diferente", diferentes);

process.exit(1);
