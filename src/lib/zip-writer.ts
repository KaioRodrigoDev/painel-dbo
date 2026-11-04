import "server-only";

import { open, readFile } from "node:fs/promises";
import * as zlib from "node:zlib";

/**
 * Gerador mínimo de .zip, para não trazer uma dependência só para empacotar meia dúzia de
 * arquivos na exportação. Cada arquivo vai comprimido (deflate) quando isso economiza
 * espaço e guardado como está quando não economiza. Nomes em UTF-8 (bit 11), para os
 * acentos aparecerem certos no Explorer.
 *
 * Limite: zip clássico, sem Zip64 — cada arquivo e o total precisam ficar abaixo de 4 GB,
 * folga enorme para um pack de dezenas de MB.
 */

export type ZipEntry = { name: string; source: Buffer | string };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// zlib.crc32 só existe a partir do Node 22.2; o painel aceita Node 20, então há a versão em JS.
const nativeCrc32 = (zlib as unknown as { crc32?: (data: Buffer) => number }).crc32;
function crc32(data: Buffer) {
  if (nativeCrc32) return nativeCrc32(data) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function writeZip(outputPath: string, entries: ZipEntry[]) {
  const stamp = dosDateTime(new Date());
  const central: Buffer[] = [];
  let offset = 0;
  const handle = await open(/* turbopackIgnore: true */ outputPath, "wx");
  try {
    for (const entry of entries) {
      const data = typeof entry.source === "string" ? await readFile(/* turbopackIgnore: true */ entry.source) : entry.source;
      const checksum = crc32(data);
      const deflated = zlib.deflateRawSync(data, { level: 6 });
      const useDeflate = deflated.length < data.length;
      const body = useDeflate ? deflated : data;
      const method = useDeflate ? 8 : 0;
      const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
      if (data.length >= 0xffffffff || offset + body.length >= 0xffffffff) throw new Error("O arquivo ficou grande demais para um .zip sem Zip64.");

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await handle.write(local);
      await handle.write(name);
      await handle.write(body);

      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(method, 10);
      header.writeUInt16LE(stamp.time, 12);
      header.writeUInt16LE(stamp.date, 14);
      header.writeUInt32LE(checksum, 16);
      header.writeUInt32LE(body.length, 20);
      header.writeUInt32LE(data.length, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt32LE(offset, 42);
      central.push(header, name);
      offset += local.length + name.length + body.length;
    }

    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    await handle.write(directory);
    await handle.write(end);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
