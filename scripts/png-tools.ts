// Leitura e escrita mínimas de PNG (8 bits, sem entrelaçamento) para preparar ícones:
// os do jogo são RGBA 32x32 e o alpha é o que recorta o ícone sobre a moldura do slot.
import { deflateSync, inflateSync } from "node:zlib";

export type Imagem = { largura: number; altura: number; pixels: Buffer }; // RGBA, 4 bytes por pixel

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf: Buffer) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const PAETH = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decodifica PNG 8 bits nos tipos 0/2/4/6 (cinza, RGB, cinza+alpha, RGBA). */
export function lerPNG(buf: Buffer): Imagem {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Não é PNG.");
  let largura = 0, altura = 0, bits = 0, tipo = 0;
  const idat: Buffer[] = [];

  for (let off = 8; off + 8 <= buf.length; ) {
    const tam = buf.readUInt32BE(off);
    const nome = buf.toString("latin1", off + 4, off + 8);
    const dados = buf.subarray(off + 8, off + 8 + tam);
    if (nome === "IHDR") {
      largura = dados.readUInt32BE(0); altura = dados.readUInt32BE(4);
      bits = dados.readUInt8(8); tipo = dados.readUInt8(9);
      if (dados.readUInt8(12) !== 0) throw new Error("PNG entrelaçado não suportado.");
    } else if (nome === "IDAT") idat.push(dados);
    else if (nome === "IEND") break;
    off += 12 + tam;
  }
  if (bits !== 8) throw new Error(`Só suporto 8 bits por canal (veio ${bits}).`);
  const canais = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipo as 0 | 2 | 4 | 6];
  if (!canais) throw new Error(`Tipo de cor ${tipo} não suportado (use RGB ou RGBA).`);

  const cru = inflateSync(Buffer.concat(idat));
  const bpp = canais;
  const linha = largura * bpp;
  const saida = Buffer.alloc(largura * altura * 4);
  const anterior = Buffer.alloc(linha);
  const atual = Buffer.alloc(linha);

  for (let y = 0; y < altura; y += 1) {
    const filtro = cru.readUInt8(y * (linha + 1));
    cru.copy(atual, 0, y * (linha + 1) + 1, y * (linha + 1) + 1 + linha);
    for (let i = 0; i < linha; i += 1) {
      const a = i >= bpp ? atual[i - bpp] : 0, b = anterior[i], c = i >= bpp ? anterior[i - bpp] : 0;
      if (filtro === 1) atual[i] = (atual[i] + a) & 0xff;
      else if (filtro === 2) atual[i] = (atual[i] + b) & 0xff;
      else if (filtro === 3) atual[i] = (atual[i] + ((a + b) >> 1)) & 0xff;
      else if (filtro === 4) atual[i] = (atual[i] + PAETH(a, b, c)) & 0xff;
    }
    for (let x = 0; x < largura; x += 1) {
      const s = x * bpp, d = (y * largura + x) * 4;
      if (canais === 1) { saida[d] = saida[d + 1] = saida[d + 2] = atual[s]; saida[d + 3] = 255; }
      else if (canais === 2) { saida[d] = saida[d + 1] = saida[d + 2] = atual[s]; saida[d + 3] = atual[s + 1]; }
      else { saida[d] = atual[s]; saida[d + 1] = atual[s + 1]; saida[d + 2] = atual[s + 2]; saida[d + 3] = canais === 4 ? atual[s + 3] : 255; }
    }
    atual.copy(anterior);
  }
  return { largura, altura, pixels: saida };
}

/** Escreve PNG RGBA 8 bits, sem filtro por linha. */
export function escreverPNG({ largura, altura, pixels }: Imagem): Buffer {
  const linha = largura * 4;
  const cru = Buffer.alloc((linha + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    cru.writeUInt8(0, y * (linha + 1));
    pixels.copy(cru, y * (linha + 1) + 1, y * linha, (y + 1) * linha);
  }
  const chunk = (nome: string, dados: Buffer) => {
    const c = Buffer.concat([Buffer.from(nome, "latin1"), dados]);
    const out = Buffer.alloc(c.length + 8);
    out.writeUInt32BE(dados.length, 0);
    c.copy(out, 4);
    out.writeUInt32BE(CRC(c), c.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(cru, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
