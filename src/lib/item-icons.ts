import "server-only";

import { createDecipheriv } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveClientPackDirectory } from "@/lib/game-paths";

const PACK_PASSWORD = "NZYGLTAJF69IS2ARV6RPMC55PELLH8UYNJ39RY8";
const HEADER_RECORD_SIZE = 140;
const HEADER_NAME_SIZE = 128;

type IconPackEntry = {
  unit: number;
  size: number;
  offset: number;
  extension: string;
};

type IconIndexCache = {
  directory: string;
  modifiedAt: number;
  size: number;
  entries: Map<string, IconPackEntry>;
};

let iconIndexCache: IconIndexCache | null = null;

export function resolveItemIconPackDirectory() {
  return resolveClientPackDirectory();
}

function createPackKey() {
  const key = Buffer.alloc(8);
  const password = Buffer.from(PACK_PASSWORD, "ascii");
  for (let index = 0; index < password.length; index += 1) {
    key[index % key.length] ^= password[index];
  }
  return Buffer.concat([key, key, key]);
}

function decryptHeader(encrypted: Buffer) {
  const decipher = createDecipheriv("des-ede3", createPackKey(), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function safeIconFileName(value: string) {
  const fileName = path.basename(value).toLowerCase();
  if (fileName !== value.toLowerCase() || !/^[a-z0-9_.-]+$/.test(fileName)) {
    throw new Error("Nome de ícone inválido.");
  }
  return fileName;
}

async function loadIconIndex() {
  const directory = resolveItemIconPackDirectory();
  const headerPath = path.join(directory, "tex.pak");
  const headerStat = await stat(/* turbopackIgnore: true */ headerPath);
  if (
    iconIndexCache?.directory === directory &&
    iconIndexCache.modifiedAt === headerStat.mtimeMs &&
    iconIndexCache.size === headerStat.size
  ) {
    return iconIndexCache;
  }

  const encrypted = await readFile(/* turbopackIgnore: true */ headerPath);
  const header = decryptHeader(encrypted);
  const entries = new Map<string, IconPackEntry>();

  for (let offset = 0; offset + HEADER_RECORD_SIZE <= header.length; offset += HEADER_RECORD_SIZE) {
    const nameEnd = header.indexOf(0, offset + 1);
    if (nameEnd < 0 || nameEnd > offset + 1 + HEADER_NAME_SIZE) continue;
    const packedPath = header.toString("latin1", offset + 1, nameEnd).toLowerCase();
    if (!packedPath.includes("\\texture\\gui\\icon\\")) continue;
    const fileName = path.win32.basename(packedPath);
    const extension = path.extname(fileName).toLowerCase();
    entries.set(fileName, {
      unit: header.readUInt8(offset),
      size: header.readUInt32LE(offset + 132),
      offset: header.readUInt32LE(offset + 136),
      extension,
    });
  }

  iconIndexCache = {
    directory,
    modifiedAt: headerStat.mtimeMs,
    size: headerStat.size,
    entries,
  };
  return iconIndexCache;
}

export async function loadGameIcon(requestedName: string) {
  const fileName = safeIconFileName(requestedName);
  const index = await loadIconIndex();
  const entry = index.entries.get(fileName);
  if (!entry) return null;

  const dataPath = path.join(index.directory, `tex${entry.unit}.pak`);
  const dataStat = await stat(/* turbopackIgnore: true */ dataPath);
  if (entry.offset + entry.size > dataStat.size) {
    throw new Error("Entrada do ícone ultrapassa o tamanho do pacote.");
  }

  const handle = await open(/* turbopackIgnore: true */ dataPath, "r");
  try {
    const buffer = Buffer.alloc(entry.size);
    const { bytesRead } = await handle.read(buffer, 0, entry.size, entry.offset);
    if (bytesRead !== entry.size) throw new Error("Leitura incompleta do ícone.");
    return {
      buffer,
      contentType: entry.extension === ".png" ? "image/png" : entry.extension === ".bmp" ? "image/bmp" : "image/vnd-ms.dds",
    };
  } finally {
    await handle.close();
  }
}

export const loadItemIcon = loadGameIcon;
