import "server-only";

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";

import { loadPackIndex, packDataFileName, resolveClientPackDirectory, type PackEntry } from "@/lib/pack-index";
import { SKILL_RDF_HEADER_SIZE, SKILL_RDF_RECORD_SIZE } from "@/lib/skill-catalog";

// O cliente le a tabela de dentro do pack, nao do RDF do servidor. Para .rdf o
// carregador nao usa senha (so o formato .edf usa), entao o conteudo dentro do pack
// esta em texto claro e pode ser corrigido no lugar.
//
// Atencao: o indice lista varias copias parecidas (-table_skill_data.rdf,
// b1table_skill_data.rdf, talokotable_skill_data.rdf). Somente a entrada exata abaixo
// e a que o cliente carrega; procurar por conteudo acertaria a copia errada.
const SKILL_TABLE_HEADER_FILE = "tbl.pak";
const SKILL_TABLE_PACKED_PATH = ".\\data\\table_skill_data.rdf";

export type SkillPackTarget = {
  directory: string;
  packFileName: string;
  packPath: string;
  entry: PackEntry;
};

export type SkillPackWriteResult = {
  packFileName: string;
  packPath: string;
  backupPath: string | null;
  beforeHash: string;
  afterHash: string;
};

export type SkillPackFieldWriter = (recordBuffer: Buffer, recordOffset: number) => void;

const hashBuffer = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** Pasta usada quando o operador nao escolhe outra na hora de publicar. */
export function defaultClientPackDirectory() {
  return resolveClientPackDirectory();
}

/**
 * Normaliza a pasta escolhida pelo operador. Aceita apenas caminho absoluto que
 * realmente contenha o indice do pack, e -- quando CLIENT_PACK_ALLOWED_ROOTS estiver
 * definida -- apenas dentro das raizes autorizadas. As gravacoes sempre ocorrem em
 * arquivos resolvidos pelo indice dentro dessa pasta, nunca num caminho recebido cru.
 */
export async function resolveRequestedPackDirectory(requested?: string | null) {
  const directory = requested?.trim() ? path.resolve(requested.trim()) : defaultClientPackDirectory();
  if (!path.isAbsolute(directory)) throw new Error("A pasta do pack do cliente precisa ser um caminho absoluto.");

  const allowedRoots = (process.env.CLIENT_PACK_ALLOWED_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));
  if (allowedRoots.length) {
    const permitida = allowedRoots.some((root) => directory === root || directory.startsWith(root + path.sep));
    if (!permitida) throw new Error("A pasta escolhida está fora das raízes autorizadas em CLIENT_PACK_ALLOWED_ROOTS.");
  }

  const headerStat = await stat(/* turbopackIgnore: true */ path.join(directory, SKILL_TABLE_HEADER_FILE)).catch(() => null);
  if (!headerStat?.isFile()) throw new Error(`A pasta escolhida não contém ${SKILL_TABLE_HEADER_FILE}; ela não parece ser a pasta pack de um cliente.`);
  return directory;
}

/** Resolve, pelo indice cifrado, qual <prefixo><unit>.pak guarda a tabela viva. */
export async function findSkillTablePackTarget(directory?: string): Promise<SkillPackTarget> {
  const packDirectory = directory ?? defaultClientPackDirectory();
  const entries = await loadPackIndex(SKILL_TABLE_HEADER_FILE, packDirectory);
  const entry = entries.get(SKILL_TABLE_PACKED_PATH.toLowerCase());
  if (!entry) throw new Error(`O índice ${SKILL_TABLE_HEADER_FILE} não possui a entrada ${SKILL_TABLE_PACKED_PATH}.`);

  const packFileName = packDataFileName(SKILL_TABLE_HEADER_FILE, entry.unit);
  const packPath = path.join(packDirectory, packFileName);
  const packStat = await stat(/* turbopackIgnore: true */ packPath);
  if (entry.offset + entry.size > packStat.size) {
    throw new Error(`A entrada da tabela de skill aponta para fora de ${packFileName}; o pack pode estar dessincronizado do índice.`);
  }
  if (entry.size <= SKILL_RDF_HEADER_SIZE || (entry.size - SKILL_RDF_HEADER_SIZE) % SKILL_RDF_RECORD_SIZE !== 0) {
    throw new Error("O tamanho da tabela de skill dentro do pack não bate com o formato do RDF.");
  }
  return { directory: packDirectory, packFileName, packPath, entry };
}

async function readSlice(packPath: string, offset: number, size: number) {
  const handle = await open(/* turbopackIgnore: true */ packPath, "r");
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, offset);
    if (bytesRead !== size) throw new Error("Leitura incompleta da tabela de skill dentro do pack.");
    return buffer;
  } finally {
    await handle.close();
  }
}

function findRecordOffset(buffer: Buffer, tblidx: number) {
  let found = -1;
  for (let offset = SKILL_RDF_HEADER_SIZE; offset + SKILL_RDF_RECORD_SIZE <= buffer.length; offset += SKILL_RDF_RECORD_SIZE) {
    if (buffer.readUInt32LE(offset) !== tblidx) continue;
    if (found !== -1) throw new Error(`A tabela dentro do pack contém mais de um registro com TBLIDX ${tblidx}.`);
    found = offset;
  }
  if (found === -1) throw new Error(`A skill ${tblidx} não existe na tabela dentro do pack.`);
  return found;
}

/**
 * Grava o registro no arquivo de pack indicado.
 *
 * Só funciona porque todo campo publicável ocupa tamanho fixo dentro de um registro de
 * 348 bytes: o arquivo não muda de tamanho e o índice continua válido, dispensando
 * reempacotamento. Criar registro novo faria o pack crescer e exigiria reconstruir o
 * índice -- por isso `findRecordOffset` recusa TBLIDX inexistente.
 */
async function patchPackFile(packPath: string, entry: PackEntry, tblidx: number, writeFields: SkillPackFieldWriter) {
  const before = await readSlice(packPath, entry.offset, entry.size);
  const recordOffset = findRecordOffset(before, tblidx);

  const after = Buffer.from(before);
  writeFields(after, recordOffset);
  if (after.length !== before.length) throw new Error("A gravação alterou o tamanho da tabela; isso exigiria reempacotar o pack.");

  if (!after.equals(before)) {
    // Só os bytes do registro mudam, entao a gravacao e pontual em vez de reescrever 18 MB.
    const handle = await open(/* turbopackIgnore: true */ packPath, "r+");
    try {
      const record = after.subarray(recordOffset, recordOffset + SKILL_RDF_RECORD_SIZE);
      await handle.write(record, 0, record.length, entry.offset + recordOffset);
      await handle.sync();
    } finally {
      await handle.close();
    }

    const written = await readSlice(packPath, entry.offset, entry.size);
    if (!written.equals(after)) throw new Error("A verificação após gravar no pack do cliente falhou.");
  }

  return { beforeHash: hashBuffer(before), afterHash: hashBuffer(after) };
}

/** Substitui em definitivo o pack do cliente, guardando backup antes. */
export async function applySkillPackChanges(
  tblidx: number,
  writeFields: SkillPackFieldWriter,
  options: { backupDirectory: string; label: string; directory?: string },
): Promise<SkillPackWriteResult> {
  const target = await findSkillTablePackTarget(options.directory);

  await mkdir(/* turbopackIgnore: true */ options.backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(options.backupDirectory, `${target.packFileName}.${stamp}.before-${options.label}.pak`);
  await copyFile(target.packPath, backupPath, fsConstants.COPYFILE_EXCL);

  const hashes = await patchPackFile(target.packPath, target.entry, tblidx, writeFields);
  return { packFileName: target.packFileName, packPath: target.packPath, backupPath, ...hashes };
}

/**
 * Gera uma cópia já corrigida para download, sem tocar no pack de origem. É o caminho
 * usado quando o operador quer só o arquivo para substituir manualmente.
 */
export async function prepareSkillPackDownload(
  tblidx: number,
  writeFields: SkillPackFieldWriter,
  options: { outputDirectory: string; directory?: string },
): Promise<SkillPackWriteResult> {
  const target = await findSkillTablePackTarget(options.directory);

  await rm(/* turbopackIgnore: true */ options.outputDirectory, { recursive: true, force: true });
  await mkdir(/* turbopackIgnore: true */ options.outputDirectory, { recursive: true });
  const outputPath = path.join(options.outputDirectory, target.packFileName);
  await copyFile(target.packPath, outputPath);

  const hashes = await patchPackFile(outputPath, target.entry, tblidx, writeFields);
  return { packFileName: target.packFileName, packPath: outputPath, backupPath: null, ...hashes };
}

/** Devolve o pack ao conteúdo do backup indicado. Usado quando a etapa do RDF falha. */
export async function restoreSkillPackBackup(packPath: string, backupPath: string) {
  await copyFile(backupPath, packPath);
}
