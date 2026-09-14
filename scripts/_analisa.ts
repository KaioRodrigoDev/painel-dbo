import { readFile } from "node:fs/promises";
import { lerPNG } from "./png-tools.ts";

const img = lerPNG(await readFile(process.argv[2]));
console.log(`${img.largura}x${img.altura}`);

const cor = (i: number) => `${img.pixels[i]},${img.pixels[i + 1]},${img.pixels[i + 2]}`;
const cantos = [0, (img.largura - 1) * 4, (img.altura - 1) * img.largura * 4, (img.altura * img.largura - 1) * 4];
console.log("cantos: " + cantos.map((i) => cor(i)).join("  |  "));

const cont = new Map<string, number>();
for (let i = 0; i < img.pixels.length; i += 4) cont.set(cor(i), (cont.get(cor(i)) ?? 0) + 1);
console.log(`\ncores distintas: ${cont.size}`);
console.log("mais frequentes:");
for (const [c, n] of [...cont].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${c.padEnd(14)} ${n} px (${((n / (img.largura * img.altura)) * 100).toFixed(1)}%)`);
}
// Quanto da borda e da cor do canto: indica se da para recortar o fundo com seguranca.
const fundo = cor(0);
let borda = 0, total = 0;
for (let y = 0; y < img.altura; y += 1) for (let x = 0; x < img.largura; x += 1) {
  if (x !== 0 && y !== 0 && x !== img.largura - 1 && y !== img.altura - 1) continue;
  total += 1;
  if (cor((y * img.largura + x) * 4) === fundo) borda += 1;
}
console.log(`\nborda com a cor do canto (${fundo}): ${borda}/${total}`);
