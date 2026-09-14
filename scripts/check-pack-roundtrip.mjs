// Verifica que cifrar o indice decifrado devolve exatamente o arquivo original.
// Se isto falhar, reescrever qualquer indice de pack e inseguro.
import { createCipheriv, createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PACK_PASSWORD = "NZYGLTAJF69IS2ARV6RPMC55PELLH8UYNJ39RY8";
const directory =
  process.env.CLIENT_PACK_DIRECTORY ??
  process.env.ITEM_ICON_PACK_DIRECTORY ??
  path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

function createPackKey() {
  const key = Buffer.alloc(8);
  const password = Buffer.from(PACK_PASSWORD, "ascii");
  for (let index = 0; index < password.length; index += 1) key[index % key.length] ^= password[index];
  return Buffer.concat([key, key, key]);
}
const decrypt = (buffer) => {
  const d = createDecipheriv("des-ede3", createPackKey(), null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(buffer), d.final()]);
};
const encrypt = (buffer) => {
  const c = createCipheriv("des-ede3", createPackKey(), null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(buffer), c.final()]);
};

let falhou = false;
for (const headerFile of ["tbl.pak", "gui.pak", "scr.pak", "tex.pak"]) {
  const original = await readFile(path.join(directory, headerFile)).catch(() => null);
  if (!original) { console.log(`${headerFile.padEnd(9)} ausente, pulado`); continue; }
  const igual = encrypt(decrypt(original)).equals(original);
  if (!igual) falhou = true;
  console.log(`${headerFile.padEnd(9)} ${original.length} bytes, múltiplo de 8: ${original.length % 8 === 0} — round-trip ${igual ? "OK" : "FALHOU"}`);
}
console.log(falhou ? "\nFALHOU: a cifra não é simétrica; não regravar índices." : "\nOK: pode regravar índices com segurança.");
process.exit(falhou ? 1 : 0);
