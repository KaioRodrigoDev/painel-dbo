import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveClientPackDirectory } from "@/lib/game-paths";
import { decryptPackHeader, scanIndexRecords } from "@/lib/pack-format";

export { decryptPackHeader, encryptPackHeader, HEADER_FIELD, HEADER_NAME_SIZE, HEADER_RECORD_SIZE, scanIndexRecords } from "@/lib/pack-format";
export type { IndexRecord } from "@/lib/pack-format";

export type PackEntry = {
  /** Sufixo numerico do arquivo de dados: unit 2 => tbl2.pak. */
  unit: number;
  /** Deslocamento do arquivo dentro do .pak de dados. */
  offset: number;
  /** Tamanho do arquivo em bytes. */
  size: number;
  /** Caminho como gravado no indice, ex.: ".\\data\\table_skill_data.rdf". */
  packedPath: string;
};

type PackIndexCache = {
  directory: string;
  headerFile: string;
  modifiedAt: number;
  size: number;
  entries: Map<string, PackEntry>;
};

const packIndexCache = new Map<string, PackIndexCache>();

// Reexportada daqui por historico: varios modulos ja importavam esta funcao de
// pack-index. A resolucao em si mora em game-paths, junto das outras.
export { resolveClientPackDirectory };

/** Nome do arquivo de dados que guarda uma entrada, ex.: tbl.pak + unit 2 => tbl2.pak. */
export function packDataFileName(headerFile: string, unit: number) {
  return `${path.basename(headerFile, ".pak")}${unit}.pak`;
}

/** Índice decifrado cru, para edições que precisam preservar bytes desconhecidos. */
export async function readRawPackIndex(headerFile: string, directory = resolveClientPackDirectory()) {
  const headerPath = path.join(directory, headerFile);
  return { headerPath, buffer: decryptPackHeader(await readFile(/* turbopackIgnore: true */ headerPath)) };
}

/**
 * Le e decifra o indice de um pack. As chaves do mapa sao o caminho interno em
 * minusculas. O cache observa mtime e tamanho do indice.
 */
export async function loadPackIndex(headerFile: string, directory = resolveClientPackDirectory()) {
  const headerPath = path.join(directory, headerFile);
  const headerStat = await stat(/* turbopackIgnore: true */ headerPath);
  const cacheKey = `${directory}|${headerFile}`;
  const cached = packIndexCache.get(cacheKey);
  if (cached && cached.modifiedAt === headerStat.mtimeMs && cached.size === headerStat.size) return cached.entries;

  const index = decryptPackHeader(await readFile(/* turbopackIgnore: true */ headerPath));
  const entries = new Map<string, PackEntry>(
    scanIndexRecords(index).map((record) => [
      record.name.toLowerCase(),
      { unit: record.unit, size: record.size, offset: record.offset, packedPath: record.name },
    ]),
  );

  packIndexCache.set(cacheKey, { directory, headerFile, modifiedAt: headerStat.mtimeMs, size: headerStat.size, entries });
  return entries;
}

export function invalidatePackIndexCache() {
  packIndexCache.clear();
}
