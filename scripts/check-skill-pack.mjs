// Valida a resolucao do pack do cliente contra os arquivos reais, replicando
// src/lib/pack-index.ts. Uso: node scripts/check-skill-pack.mjs [tblidx]
import { createDecipheriv } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

const PACK_PASSWORD = "NZYGLTAJF69IS2ARV6RPMC55PELLH8UYNJ39RY8";
const HEADER_RECORD_SIZE = 140;
const HEADER_NAME_SIZE = 128;
const RDF_HEADER_SIZE = 1;
const RDF_RECORD_SIZE = 348;
const PACKED_PATH = ".\\data\\table_skill_data.rdf";

const packDirectory =
  process.env.CLIENT_PACK_DIRECTORY ??
  process.env.ITEM_ICON_PACK_DIRECTORY ??
  path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const serverRdf =
  process.env.SKILL_TABLE_PATH ??
  path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");
const tblidx = Number(process.argv[2] ?? 10312);

function createPackKey() {
  const key = Buffer.alloc(8);
  const password = Buffer.from(PACK_PASSWORD, "ascii");
  for (let index = 0; index < password.length; index += 1) key[index % key.length] ^= password[index];
  return Buffer.concat([key, key, key]);
}

function decryptHeader(encrypted) {
  const decipher = createDecipheriv("des-ede3", createPackKey(), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function findRecordOffset(buffer, id) {
  for (let offset = RDF_HEADER_SIZE; offset + RDF_RECORD_SIZE <= buffer.length; offset += RDF_RECORD_SIZE) {
    if (buffer.readUInt32LE(offset) === id) return offset;
  }
  throw new Error(`TBLIDX ${id} nao encontrado.`);
}

const campos = (buffer, offset) => ({
  appointTarget: buffer.readUInt8(offset + 108),
  applyTarget: buffer.readUInt8(offset + 109),
  applyTargetMax: buffer.readUInt8(offset + 110),
  applyRange: buffer.readUInt8(offset + 111),
  applyAreaSize1: buffer.readUInt8(offset + 112),
  applyAreaSize2: buffer.readUInt8(offset + 113),
});

const header = decryptHeader(await readFile(path.join(packDirectory, "tbl.pak")));
const entries = new Map();
for (let offset = 0; offset + HEADER_RECORD_SIZE <= header.length; offset += HEADER_RECORD_SIZE) {
  const nameEnd = header.indexOf(0, offset + 1);
  if (nameEnd < 0 || nameEnd > offset + 1 + HEADER_NAME_SIZE) continue;
  const packedPath = header.toString("latin1", offset + 1, nameEnd);
  if (!packedPath) continue;
  entries.set(packedPath.toLowerCase(), {
    unit: header.readUInt8(offset),
    size: header.readUInt32LE(offset + 132),
    offset: header.readUInt32LE(offset + 136),
    packedPath,
  });
}

const entry = entries.get(PACKED_PATH.toLowerCase());
if (!entry) throw new Error(`Entrada ${PACKED_PATH} ausente do indice (${entries.size} entradas lidas).`);

const packFileName = `tbl${entry.unit}.pak`;
console.log(`indice: ${entries.size} entradas`);
console.log(`entrada viva: ${entry.packedPath} -> ${packFileName} offset=${entry.offset} size=${entry.size}`);

const handle = await open(path.join(packDirectory, packFileName), "r");
const slice = Buffer.alloc(entry.size);
await handle.read(slice, 0, entry.size, entry.offset);
await handle.close();

if ((slice.length - RDF_HEADER_SIZE) % RDF_RECORD_SIZE !== 0) throw new Error("Formato da tabela dentro do pack invalido.");

const clienteOffset = findRecordOffset(slice, tblidx);
const servidor = await readFile(serverRdf);
const servidorOffset = findRecordOffset(servidor, tblidx);

const noCliente = campos(slice, clienteOffset);
const noServidor = campos(servidor, servidorOffset);
console.log(`\nregistro ${tblidx} (offset ${clienteOffset} na tabela, ${entry.offset + clienteOffset} no ${packFileName})`);
console.log("  cliente :", noCliente);
console.log("  servidor:", noServidor);

const divergentes = Object.keys(noServidor).filter((chave) => noServidor[chave] !== noCliente[chave]);
console.log(divergentes.length ? `\nDIVERGEM em: ${divergentes.join(", ")}` : "\nOK - cliente e servidor batem");
