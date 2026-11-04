// Formato dos packs do cliente, sem nenhuma E/S: cifra do indice, leitura dos registros
// e reconstrucao de uma unidade. Fica separado de pack-writer.ts para poder ser exercido
// direto por scripts/check-pack-rebuild.ts sem depender do runtime do Next.
import { createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Senhas de pack conhecidas: o NTL_PACK_CRYPT_KEY de NtlPLResourcePack.cpp/.h de cada
 * cliente. Cada cliente usa uma so, e o indice nao diz qual -- por isso a senha e
 * descoberta tentando cada uma (ver detectPackPassword). Um cliente com senha fora desta
 * lista funciona com CLIENT_PACK_PASSWORD no .env.local.
 */
export const KNOWN_PACK_PASSWORDS = [
  { label: "DBO/DBOW", password: "NZYGLTAJF69IS2ARV6RPMC55PELLH8UYNJ39RY8" },
  { label: "MDBO", password: "FFCF4403F048FFC683C30883FB1072E1SDFDF4D" },
  // Alternativas que aparecem comentadas no fonte do cliente.
  { label: "KKH7", password: "KKH7JSDFSD077VXCVDF789SDFWE567PPAE45VF5" },
  { label: "jhssugi", password: "jhssugi" },
] as const;

export const HEADER_RECORD_SIZE = 140;
export const HEADER_NAME_SIZE = 128;
/** Deslocamentos dentro de um registro do indice. */
export const HEADER_FIELD = { unit: 0, name: 1, size: 132, offset: 136 } as const;

export type IndexRecord = {
  /** Posicao do registro dentro do indice decifrado. */
  recordOffset: number;
  unit: number;
  name: string;
  size: number;
  offset: number;
};

function createPackKey(packPassword: string) {
  const key = Buffer.alloc(8);
  const password = Buffer.from(packPassword, "ascii");
  for (let index = 0; index < password.length; index += 1) key[index % key.length] ^= password[index];
  return Buffer.concat([key, key, key]);
}

function desDecrypt(encrypted: Buffer, password: string) {
  const decipher = createDecipheriv("des-ede3", createPackKey(password), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Senhas a tentar, na ordem: a do .env.local primeiro, depois as conhecidas. */
function candidatePasswords() {
  const configured = process.env.CLIENT_PACK_PASSWORD?.trim();
  const known: string[] = KNOWN_PACK_PASSWORDS.map((entry) => entry.password);
  return configured ? [configured, ...known.filter((password) => password !== configured)] : known;
}

/** Registros usados para reconhecer a senha certa: 4 x 140 = 560 bytes, multiplo de 8. */
const DETECTION_RECORDS = 4;

/**
 * Com a senha errada o DES nao falha: devolve lixo. O lixo quase nunca tem cara de
 * registro -- nome terminado em zero dentro dos 128 bytes, sem bytes de controle e com
 * barra de caminho (".\texture\..."). Registro de nome vazio e ignorado.
 */
function looksLikePackIndex(plain: Buffer) {
  let named = 0;
  for (let recordOffset = 0; recordOffset + HEADER_RECORD_SIZE <= plain.length; recordOffset += HEADER_RECORD_SIZE) {
    const nameStart = recordOffset + HEADER_FIELD.name;
    if (plain[nameStart] === 0) continue;
    const nameEnd = plain.indexOf(0, nameStart);
    if (nameEnd < 0 || nameEnd > nameStart + HEADER_NAME_SIZE) return false;
    const name = plain.subarray(nameStart, nameEnd);
    if (name.some((byte) => byte < 0x20) || !name.includes(0x5c)) return false;
    named += 1;
  }
  return named > 0;
}

/**
 * Descobre com que senha o indice foi cifrado. Indice pequeno demais para ter um registro
 * usa a configurada (ou a padrao). Nenhuma senha serviu: erro claro, em vez de devolver
 * um indice de lixo que parece vazio.
 */
export function detectPackPassword(encrypted: Buffer) {
  const candidates = candidatePasswords();
  const sample = encrypted.subarray(0, Math.min(encrypted.length & ~7, DETECTION_RECORDS * HEADER_RECORD_SIZE));
  if (sample.length < HEADER_RECORD_SIZE) return candidates[0]!;
  const password = candidates.find((candidate) => looksLikePackIndex(desDecrypt(sample, candidate)));
  if (!password) {
    throw new Error(
      "Não foi possível decifrar o índice do pack com nenhuma senha conhecida. Este cliente usa outra senha: " +
        "coloque-a em CLIENT_PACK_PASSWORD no .env.local (é o NTL_PACK_CRYPT_KEY do fonte do cliente).",
    );
  }
  return password;
}

/** Nome curto da senha, para log: "MDBO", "DBO/DBOW" ou "CLIENT_PACK_PASSWORD". */
export function describePackPassword(password: string) {
  return KNOWN_PACK_PASSWORDS.find((entry) => entry.password === password)?.label ?? "CLIENT_PACK_PASSWORD";
}

// Senhas com que algum indice foi decifrado neste processo, para encryptPackHeader saber
// regravar com a mesma quando ninguem a informa.
const passwordsRead = new Set<string>();

/** Decifra o indice. Sem `password`, a senha e descoberta (detectPackPassword). */
export function decryptPackHeader(encrypted: Buffer, password = detectPackPassword(encrypted)) {
  passwordsRead.add(password);
  return desDecrypt(encrypted, password);
}

/**
 * Inversa de decryptPackHeader. Exige tamanho múltiplo de 8 (bloco do DES).
 *
 * Regravar com outra senha deixa o cliente sem conseguir ler o pack, entao sem `password`
 * vale a senha com que os indices deste processo foram lidos -- e, se foram lidos com
 * senhas diferentes, ela tem que ser informada.
 */
export function encryptPackHeader(plain: Buffer, password?: string) {
  if (plain.length % 8 !== 0) throw new Error("O índice do pack precisa ser múltiplo de 8 bytes para ser cifrado.");
  if (!password && passwordsRead.size > 1) {
    throw new Error("Índices com senhas diferentes foram lidos neste processo; informe a senha ao regravar.");
  }
  const key = password ?? [...passwordsRead][0] ?? candidatePasswords()[0]!;
  const cipher = createCipheriv("des-ede3", createPackKey(key), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

/** Registros nomeados do indice decifrado, na ordem em que aparecem. */
export function scanIndexRecords(index: Buffer): IndexRecord[] {
  const records: IndexRecord[] = [];
  for (let recordOffset = 0; recordOffset + HEADER_RECORD_SIZE <= index.length; recordOffset += HEADER_RECORD_SIZE) {
    const nameStart = recordOffset + HEADER_FIELD.name;
    const nameEnd = index.indexOf(0, nameStart);
    if (nameEnd < 0 || nameEnd > nameStart + HEADER_NAME_SIZE) continue;
    const name = index.toString("latin1", nameStart, nameEnd);
    if (!name) continue;
    records.push({
      recordOffset,
      unit: index.readUInt8(recordOffset + HEADER_FIELD.unit),
      name,
      size: index.readUInt32LE(recordOffset + HEADER_FIELD.size),
      offset: index.readUInt32LE(recordOffset + HEADER_FIELD.offset),
    });
  }
  return records;
}

/**
 * Reconstroi uma unidade de pack concatenando seus arquivos na ordem original de offset,
 * trocando os que vierem em `replacements`. Devolve o novo conteudo e o indice ajustado.
 *
 * O indice sai do original decifrado com apenas offset e size reescritos, para preservar
 * registros vazios, padding e qualquer campo nao interpretado aqui.
 */
export function rebuildPackUnit(options: {
  index: Buffer;
  records: IndexRecord[];
  unit: number;
  unitContent: Buffer;
  replacements: Map<string, Buffer>;
}) {
  const { index, records, unit, unitContent } = options;
  const replacements = new Map([...options.replacements].map(([name, content]) => [name.toLowerCase(), content]));

  const nextIndex = Buffer.from(index);
  const daUnidade = records.filter((record) => record.unit === unit).sort((a, b) => a.offset - b.offset);

  const pedacos: Buffer[] = [];
  let cursor = 0;
  for (const record of daUnidade) {
    const substituicao = replacements.get(record.name.toLowerCase());
    if (!substituicao && record.offset + record.size > unitContent.length) {
      throw new Error(`${record.name} aponta para fora do pack; índice e dados estão dessincronizados.`);
    }
    const conteudo = substituicao ?? unitContent.subarray(record.offset, record.offset + record.size);
    pedacos.push(conteudo);
    nextIndex.writeUInt32LE(cursor, record.recordOffset + HEADER_FIELD.offset);
    nextIndex.writeUInt32LE(conteudo.length, record.recordOffset + HEADER_FIELD.size);
    cursor += conteudo.length;
  }

  return { unitContent: Buffer.concat(pedacos, cursor), index: nextIndex };
}

/**
 * Acrescenta um arquivo novo a uma unidade, com um registro novo no fim do indice.
 *
 * O cliente le o indice ate acabar o buffer (CNtlPLResourcePack::LoadPack), entao um
 * registro no fim e encontrado normalmente. O indice cresce e volta a ser multiplo de 8
 * com zeros, exigencia do bloco do DES.
 */
export function appendPackFile(options: { index: Buffer; records: IndexRecord[]; unit: number; unitContent: Buffer; name: string; content: Buffer }) {
  const { index, records, unit, unitContent, name, content } = options;
  if (records.some((record) => record.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`${name} já existe no índice; use a substituição em vez da inclusão.`);
  }
  const nameBytes = Buffer.from(name, "latin1");
  if (nameBytes.length >= HEADER_NAME_SIZE) throw new Error(`O caminho ${name} não cabe no registro do índice.`);

  const record = Buffer.alloc(HEADER_RECORD_SIZE);
  record.writeUInt8(unit, HEADER_FIELD.unit);
  nameBytes.copy(record, HEADER_FIELD.name);
  record.writeUInt32LE(content.length, HEADER_FIELD.size);
  record.writeUInt32LE(unitContent.length, HEADER_FIELD.offset);

  // O indice e lido em passos de 140 bytes a partir do inicio, tanto pelo cliente quanto
  // por scanIndexRecords. Um registro colado no fim do arquivo cairia fora desse passo e
  // seria invisivel, entao ele entra logo apos o ultimo registro completo -- por cima do
  // enchimento final, que precisa estar zerado para nao se perder nada.
  const fimDosRegistros = Math.floor(index.length / HEADER_RECORD_SIZE) * HEADER_RECORD_SIZE;
  const sobra = index.subarray(fimDosRegistros);
  if (sobra.some((byte) => byte !== 0)) {
    throw new Error("O índice termina com bytes não nulos fora do passo de registro; inclusão abortada para não perdê-los.");
  }

  const semPadding = Buffer.concat([index.subarray(0, fimDosRegistros), record]);
  const padding = (8 - (semPadding.length % 8)) % 8;
  return {
    index: padding ? Buffer.concat([semPadding, Buffer.alloc(padding)]) : semPadding,
    unitContent: Buffer.concat([unitContent, content]),
  };
}
