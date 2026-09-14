import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "@/lib/pack-format";
import { invalidatePackIndexCache, packDataFileName, readRawPackIndex, resolveClientPackDirectory } from "@/lib/pack-index";

// Um pack e a concatenacao dos arquivos que ele guarda; o indice diz onde cada um
// comeca e quanto ocupa. Trocar um arquivo por outro de tamanho diferente invade o
// vizinho, entao a unidade afetada e reconstruida inteira e os offsets sao recalculados.
//
// O indice e regravado byte a byte a partir do original decifrado, mexendo apenas nos
// campos de offset e size dos registros afetados. Assim registros vazios, padding e
// qualquer campo que eu nao interprete sobrevivem intactos.

export type PackReplacement = { packedPath: string; content: Buffer };

export type PackWriteResult = {
  headerPath: string;
  backups: string[];
  units: { unit: number; packPath: string; sizeBefore: number; sizeAfter: number }[];
  files: { packedPath: string; sizeBefore: number; sizeAfter: number; sha256: string }[];
};

const hashBuffer = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** Copia crua de um arquivo guardado dentro de um pack. */
export async function readPackFileContent(headerFile: string, packedPath: string, directory = resolveClientPackDirectory()) {
  const { buffer: index } = await readRawPackIndex(headerFile, directory);
  const record = scanIndexRecords(index).find((entry) => entry.name.toLowerCase() === packedPath.toLowerCase());
  if (!record) throw new Error(`${packedPath} não existe no índice ${headerFile}.`);

  const packPath = path.join(directory, packDataFileName(headerFile, record.unit));
  const handle = await open(/* turbopackIgnore: true */ packPath, "r");
  try {
    const content = Buffer.alloc(record.size);
    const { bytesRead } = await handle.read(content, 0, record.size, record.offset);
    if (bytesRead !== record.size) throw new Error(`Leitura incompleta de ${packedPath} em ${path.basename(packPath)}.`);
    return content;
  } finally {
    await handle.close();
  }
}

/**
 * Substitui arquivos dentro de um pack, reconstruindo as unidades afetadas e regravando
 * o índice. Faz backup de tudo que vai mudar antes de escrever e restaura em caso de
 * falha, para nunca deixar índice e dados dessincronizados.
 */
export async function replacePackFiles(
  headerFile: string,
  replacements: PackReplacement[],
  options: { directory?: string; backupDirectory: string; label: string },
): Promise<PackWriteResult> {
  if (!replacements.length) throw new Error("Nenhum arquivo para substituir.");
  const directory = options.directory ?? resolveClientPackDirectory();
  const { headerPath, buffer: index } = await readRawPackIndex(headerFile, directory);
  const records = scanIndexRecords(index);

  const porNome = new Map(records.map((record) => [record.name.toLowerCase(), record]));
  const alvos = replacements.map((replacement) => {
    const record = porNome.get(replacement.packedPath.toLowerCase());
    if (!record) throw new Error(`${replacement.packedPath} não existe no índice ${headerFile}.`);
    return { record, content: replacement.content };
  });

  await mkdir(/* turbopackIgnore: true */ options.backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups: { source: string; backup: string }[] = [];
  const temporarios: { temporary: string; final: string }[] = [];

  const backup = async (filePath: string) => {
    const destino = path.join(options.backupDirectory, `${path.basename(filePath)}.${stamp}.before-${options.label}.pak`);
    await copyFile(filePath, destino, fsConstants.COPYFILE_EXCL);
    backups.push({ source: filePath, backup: destino });
    return destino;
  };

  try {
    const units: PackWriteResult["units"] = [];
    let novoIndice = Buffer.from(index);

    for (const unit of [...new Set(alvos.map((alvo) => alvo.record.unit))].sort((a, b) => a - b)) {
      const packPath = path.join(directory, packDataFileName(headerFile, unit));
      const original = await readFile(/* turbopackIgnore: true */ packPath);
      await backup(packPath);

      const rebuilt = rebuildPackUnit({
        index: novoIndice,
        records,
        unit,
        unitContent: original,
        replacements: new Map(alvos.filter((alvo) => alvo.record.unit === unit).map((alvo) => [alvo.record.name, alvo.content])),
      });
      novoIndice = rebuilt.index;

      const temporary = `${packPath}.admin-${randomUUID()}.tmp`;
      await writeFile(temporary, rebuilt.unitContent, { flag: "wx" });
      temporarios.push({ temporary, final: packPath });
      units.push({ unit, packPath, sizeBefore: original.length, sizeAfter: rebuilt.unitContent.length });
    }

    const indiceTemporary = `${headerPath}.admin-${randomUUID()}.tmp`;
    await backup(headerPath);
    await writeFile(indiceTemporary, encryptPackHeader(novoIndice), { flag: "wx" });
    temporarios.push({ temporary: indiceTemporary, final: headerPath });

    for (const { temporary, final } of temporarios) await rename(temporary, final);
    invalidatePackIndexCache();

    // Confere pelo caminho normal de leitura: se o indice e os dados nao baterem, o
    // conteudo relido sai diferente do que foi gravado.
    const files: PackWriteResult["files"] = [];
    for (const alvo of alvos) {
      const relido = await readPackFileContent(headerFile, alvo.record.name, directory);
      if (!relido.equals(alvo.content)) throw new Error(`A verificação após gravar falhou em ${alvo.record.name}.`);
      files.push({ packedPath: alvo.record.name, sizeBefore: alvo.record.size, sizeAfter: alvo.content.length, sha256: hashBuffer(alvo.content) });
    }

    return { headerPath, backups: backups.map((entry) => entry.backup), units, files };
  } catch (error) {
    for (const { temporary } of temporarios) await unlink(temporary).catch(() => undefined);
    // Se algum rename ja tinha passado, o backup devolve o arquivo ao estado anterior.
    for (const { source, backup: backupPath } of backups) await copyFile(backupPath, source).catch(() => undefined);
    invalidatePackIndexCache();
    throw error;
  }
}
