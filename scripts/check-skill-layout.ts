// Exercita src/lib/skill-layout-format.ts contra um .scr real extraido do gui.pak.
// Uso: node --experimental-strip-types scripts/check-skill-layout.ts [arquivo.scr]
import { readFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, scanIndexRecords } from "../src/lib/pack-format.ts";
import { parseSkillLayout, serializeSkillLayout } from "../src/lib/skill-layout-format.ts";

const directory =
  process.env.CLIENT_PACK_DIRECTORY ??
  process.env.ITEM_ICON_PACK_DIRECTORY ??
  path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
const alvo = (process.argv[2] ?? ".\\gui\\skill\\hfi_skill.scr").toLowerCase();

const falhas: string[] = [];
const check = (ok: boolean, descricao: string) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${descricao}`);
  if (!ok) falhas.push(descricao);
};

const index = decryptPackHeader(await readFile(path.join(directory, "gui.pak")));
const record = scanIndexRecords(index).find((entry) => entry.name.toLowerCase() === alvo);
if (!record) throw new Error(`${alvo} não está no índice gui.pak.`);
const unit = await readFile(path.join(directory, `gui${record.unit}.pak`));
const source = unit.subarray(record.offset, record.offset + record.size).toString("latin1");

const layout = parseSkillLayout(source);
const ocupadas = layout.cells.filter((cell) => cell.tblidx !== null);
console.log(`${record.name} — ${record.size} bytes`);
console.log(`grade ${layout.columns} colunas x ${layout.rows} linhas`);
console.log(`células: ${layout.cells.length} (${ocupadas.length} ocupadas, ${layout.cells.length - ocupadas.length} vazias)`);
console.log(`setas: ${layout.lines.length} (${layout.lines.filter((l) => l.kind === "UpgradeLine").length} retas, ${layout.lines.filter((l) => l.kind === "OptionLine").length} com cotovelo)\n`);

console.log("grade (tblidx por célula, · = vazia):");
for (let row = 0; row < layout.rows; row += 1) {
  const linha = [];
  for (let column = 0; column < layout.columns; column += 1) {
    const cell = layout.cells.find((entry) => entry.column === column && entry.row === row);
    linha.push(!cell ? "       " : cell.tblidx === null ? "   ·   " : String(cell.tblidx).padStart(7));
  }
  if (linha.join("").trim()) console.log(`  ${String(row).padStart(2)} |${linha.join("")}`);
}

console.log("\nsetas declaradas:");
for (const line of layout.lines) console.log(`  ${line.kind.padEnd(12)} ${line.beginSkill} (${line.beginAttach}) -> ${line.endSkill} (${line.endAttach})`);

console.log("\nverificações:");
check(serializeSkillLayout(layout, new Map()) === source, "round-trip sem mudanças devolve o arquivo idêntico");
check(layout.cells.every((cell) => cell.x > 0 && cell.y > 0), "toda célula trouxe x e y do arquivo");
check(new Set(ocupadas.map((cell) => cell.tblidx)).size === ocupadas.length, "nenhum TBLIDX duplicado na grade");

// Mover uma skill para uma celula vazia e conferir que so as duas mudaram.
const origem = ocupadas[0];
const destino = layout.cells.find((cell) => cell.tblidx === null && cell.kind === origem.kind);
if (!destino) throw new Error("Nenhuma célula vazia compatível para testar o movimento.");
const movido = serializeSkillLayout(
  layout,
  new Map([
    [`${origem.column},${origem.row}`, null],
    [`${destino.column},${destino.row}`, origem.tblidx],
  ]),
);
const depois = parseSkillLayout(movido);
const celula = (l: typeof layout, c: number, r: number) => l.cells.find((cell) => cell.column === c && cell.row === r);

console.log(`\nmovendo ${origem.tblidx} de (${origem.column},${origem.row}) para (${destino.column},${destino.row}):`);
check(celula(depois, origem.column, origem.row)?.tblidx === null, "célula de origem ficou vazia");
check(celula(depois, destino.column, destino.row)?.tblidx === origem.tblidx, "célula de destino recebeu a skill");
check(celula(depois, destino.column, destino.row)?.x === destino.x && celula(depois, destino.column, destino.row)?.y === destino.y, "x e y são os da célula de destino, não os da origem");
check(depois.cells.length === layout.cells.length && depois.lines.length === layout.lines.length, "contagem de células e setas não mudou");

const inalteradas = layout.cells.filter((cell) => !(cell.column === origem.column && cell.row === origem.row) && !(cell.column === destino.column && cell.row === destino.row));
check(inalteradas.every((cell) => celula(depois, cell.column, cell.row)?.tblidx === cell.tblidx), `as outras ${inalteradas.length} células ficaram intactas`);
check(depois.lines.every((line, i) => line.beginSkill === layout.lines[i].beginSkill && line.endSkill === layout.lines[i].endSkill), "as setas não foram tocadas");

// ---- setas ----
console.log("\nsetas:");
const livres = layout.lines.filter((line) => !line.active);
const ativas = layout.lines.filter((line) => line.active);
console.log(`  ${layout.lines.length} slots (${ativas.length} com seta, ${livres.length} livres)`);

check(ativas.length === 11 || ativas.length > 0, "slots ativos foram lidos");
check(livres.length > 0, "slots comentados também foram lidos (podem receber seta nova)");

// Criar uma seta num slot livre e remover uma existente, e conferir o resto.
const novoSlot = livres[0];
const removida = ativas[0];
const editado = serializeSkillLayout(
  layout,
  new Map(),
  new Map([
    [`${novoSlot.column},${novoSlot.row}`, { kind: "OptionLine", beginSkill: ativas[0].beginSkill, endSkill: ativas[1].endSkill, beginAttach: "right", endAttach: "up" }],
    [`${removida.column},${removida.row}`, null],
  ]),
);
const depoisLinhas = parseSkillLayout(editado);
const acha = (l: typeof layout, c: number, r: number) => l.lines.find((line) => line.column === c && line.row === r);

check(acha(depoisLinhas, novoSlot.column, novoSlot.row)?.active === true, "slot livre virou seta ativa");
check(acha(depoisLinhas, novoSlot.column, novoSlot.row)?.kind === "OptionLine", "tipo da seta nova foi gravado");
check(acha(depoisLinhas, novoSlot.column, novoSlot.row)?.beginAttach === "right", "attachpos da seta nova foi gravado");
check(acha(depoisLinhas, removida.column, removida.row)?.active === false, "seta removida virou slot livre");
check(depoisLinhas.lines.length === layout.lines.length, "quantidade de slots não mudou");
check(depoisLinhas.cells.every((cell, i) => cell.tblidx === layout.cells[i].tblidx), "nenhuma célula de skill foi tocada");

const intactas = layout.lines.filter((line) => line !== novoSlot && line !== removida);
check(
  intactas.every((line) => { const d = acha(depoisLinhas, line.column, line.row); return d?.active === line.active && d?.beginSkill === line.beginSkill && d?.endSkill === line.endSkill; }),
  `os outros ${intactas.length} slots ficaram intactos`,
);
check(serializeSkillLayout(layout, new Map(), new Map()) === source, "round-trip de setas sem mudanças devolve o arquivo idêntico");


// ---- tipo do bloco ----
// O cliente escolhe a TABELA pelo tipo do bloco (skill/htb/action). Se o tipo ficar com
// a célula em vez de acompanhar a skill, o id vai parar na tabela errada e o ícone some.
console.log("\ntipos de bloco:");
const porTipo = new Map<string, number[]>();
for (const cell of ocupadas) porTipo.set(cell.kind, [...(porTipo.get(cell.kind) ?? []), cell.tblidx!]);
for (const [kind, ids] of porTipo) console.log(`  ${kind.padEnd(14)} ${ids.length} skill(s)`);

check(ocupadas.every((c) => ["skill", "htb", "action"].includes(c.kind)), "todo bloco ativo usa um tipo que o cliente aceita");

const tipos = [...porTipo.keys()];
if (tipos.length > 1) {
  const celA = ocupadas.find((c) => c.kind === tipos[0])!;
  const celB = ocupadas.find((c) => c.kind === tipos[1])!;
  const trocado = serializeSkillLayout(layout, new Map([
    [`${celA.column},${celA.row}`, celB.tblidx],
    [`${celB.column},${celB.row}`, celA.tblidx],
  ]));
  const dp = parseSkillLayout(trocado);
  const achaCel = (c: number, r: number) => dp.cells.find((x) => x.column === c && x.row === r);
  console.log(`  trocando ${celA.tblidx} ("${tipos[0]}") com ${celB.tblidx} ("${tipos[1]}"):`);
  check(achaCel(celA.column, celA.row)?.kind === tipos[1], `a skill trazida manteve o tipo "${tipos[1]}"`);
  check(achaCel(celB.column, celB.row)?.kind === tipos[0], `a skill levada manteve o tipo "${tipos[0]}"`);
  check(achaCel(celA.column, celA.row)?.tblidx === celB.tblidx && achaCel(celB.column, celB.row)?.tblidx === celA.tblidx, "os ids trocaram de lugar");
} else {
  console.log("  (arquivo só tem um tipo; troca entre tipos não testável aqui)");
}

console.log(falhas.length ? `\nFALHOU em ${falhas.length} verificação(ões).` : "\nTodas as verificações passaram.");
process.exit(falhas.length ? 1 : 0);
