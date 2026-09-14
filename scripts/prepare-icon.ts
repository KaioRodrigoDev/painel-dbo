// Prepara um PNG para virar ícone do jogo: confere 32x32 e recorta o fundo em alpha.
//
// Os ícones do cliente são RGBA e o alpha é o que assenta o desenho sobre a moldura do
// slot. Uma imagem sem alpha aparece como um quadrado sólido.
//
// O recorte parte das bordas e só espalha por pixels contíguos da cor de fundo, então
// uma área interna da mesma cor (um olho escuro, uma sombra) continua opaca.
//
// Uso: node --experimental-strip-types scripts/prepare-icon.ts <entrada.png> <saida.png> [tolerancia]
import { readFile, writeFile } from "node:fs/promises";

import { escreverPNG, lerPNG } from "./png-tools.ts";

const [, , entrada, saida, tolArg] = process.argv;
if (!entrada || !saida) { console.log("uso: prepare-icon.ts <entrada.png> <saida.png> [tolerancia]"); process.exit(1); }
const tolerancia = Number(tolArg ?? 10);

const img = lerPNG(await readFile(entrada));
console.log(`entrada: ${img.largura}x${img.altura}`);
if (img.largura !== 32 || img.altura !== 32) {
  console.log(`AVISO: o cliente recorta em 32x32 (SKILLCUSTOMIZE_ICON_SIZE); ${img.largura}x${img.altura} vai perder imagem ou sobrar vazio.`);
}

const { largura: W, altura: H, pixels } = img;
const idx = (x: number, y: number) => (y * W + x) * 4;
const fundo = [pixels[0], pixels[1], pixels[2]];
const parecido = (i: number) =>
  Math.abs(pixels[i] - fundo[0]) <= tolerancia && Math.abs(pixels[i + 1] - fundo[1]) <= tolerancia && Math.abs(pixels[i + 2] - fundo[2]) <= tolerancia;

// Preenchimento a partir de todos os pixels de borda que casam com a cor do canto.
const visitado = new Uint8Array(W * H);
const fila: number[] = [];
for (let x = 0; x < W; x += 1) { fila.push(x, 0, x, H - 1); }
for (let y = 0; y < H; y += 1) { fila.push(0, y, W - 1, y); }

let recortados = 0;
while (fila.length) {
  const y = fila.pop()!, x = fila.pop()!;
  if (x < 0 || y < 0 || x >= W || y >= H || visitado[y * W + x]) continue;
  const i = idx(x, y);
  if (!parecido(i)) continue;
  visitado[y * W + x] = 1;
  pixels[i + 3] = 0;
  recortados += 1;
  fila.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}

const opacos = W * H - recortados;
console.log(`cor de fundo: ${fundo.join(",")} (tolerância ${tolerancia})`);
console.log(`recortados: ${recortados} px  |  opacos: ${opacos} px (${((opacos / (W * H)) * 100).toFixed(1)}%)`);
if (!recortados) console.log("AVISO: nada foi recortado — a borda não casou com a cor do canto.");
if (opacos < 20) console.log("AVISO: sobrou quase nada opaco — a tolerância pode estar alta demais.");

await writeFile(saida, escreverPNG(img));
console.log(`\ngravado: ${saida}`);
