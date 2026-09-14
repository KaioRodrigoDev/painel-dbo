// Preenche uma árvore de transformação com uma lista de skills, em ordem, de cima para
// baixo e da esquerda para a direita. É só um arranjo inicial: a posição final se ajusta
// arrastando na aba "Árvore de skills" do painel.
//
// O tipo do bloco (skill/htb/action) de cada skill é herdado da árvore de classe, porque
// é ele que diz em qual tabela o cliente procura o id.
//
// Uso: node --experimental-strip-types scripts/fill-transform-tree.ts <prefixo> [--apply]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptPackHeader, encryptPackHeader, rebuildPackUnit, scanIndexRecords } from "../src/lib/pack-format.ts";
import { parseSkillLayout, renderCell, serializeSkillLayout } from "../src/lib/skill-layout-format.ts";

/** Transformações de cada classe base. Acrescentar aqui conforme forem definidas. */
const POR_CLASSE: Record<string, number[]> = {
  // Skills com graus encadeados (dwNextSkillTblidx) entram só no grau 1: o cliente sobe
  // os demais por upgrade, como faz com o Double Strike. Por isso o Kaioken ocupa uma
  // célula só, e não uma por grau.
  hfi: [
    20081,
    2032061, 2032062, 2032068, 2032064, 2032065, 2032066, 2032067,
    2032077, 2032079, 2032081, 2032083, 2032085, 2032087, 2032089, 2032091,
    2032120, 3000022, 300028,
  ],
  hmy: [
    120101,
    2032069, 2032070, 2032071, 2032072, 2032073, 2032074, 2032075,
    2032078, 2032080, 2032082, 2032084, 2032086, 2032088, 2032090, 2032092,
    2032121, 3000023, 300029,
  ],
};

/** Graus extras ja gravados que devem sair da grade. */
const REMOVER: Record<string, number[]> = { hfi: [20082, 20083], hmy: [120102, 120103] };

const prefixo = (process.argv[2] ?? "hfi").toLowerCase();
const SKILLS = POR_CLASSE[prefixo];
if (!SKILLS) { console.log(`Sem lista de transformações para "${prefixo}". Classes definidas: ${Object.keys(POR_CLASSE).join(", ")}`); process.exit(1); }
const aplicar = process.argv.includes("--apply");
const directory =
  process.env.CLIENT_PACK_DIRECTORY ??
  process.env.ITEM_ICON_PACK_DIRECTORY ??
  path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");

const RDF_HEADER = 1, RDF_RECORD = 348;
const rdfPath = process.env.SKILL_TABLE_PATH ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv", "resource", "server_data", "table", "rdf", "Table_Skill_Data.rdf");
const rdf = await readFile(rdfPath);
function nomeDaSkill(tblidx: number) {
  for (let offset = RDF_HEADER; offset + RDF_RECORD <= rdf.length; offset += RDF_RECORD) {
    if (rdf.readUInt32LE(offset) === tblidx) return rdf.toString("utf16le", offset + 8, offset + 90).split("\0")[0] || `skill ${tblidx}`;
  }
  return null;
}

const indicePath = path.join(directory, "gui.pak");
const index = decryptPackHeader(await readFile(indicePath));
const records = scanIndexRecords(index);
const leia = (nome: string) => {
  const record = records.find((entry) => entry.name.toLowerCase() === nome.toLowerCase());
  if (!record) throw new Error(`${nome} não está no índice.`);
  return record;
};

const alvo = leia(`.\\gui\\skill\\${prefixo}_transform.scr`);
const classe = leia(`.\\gui\\skill\\${prefixo}_skill.scr`);
const unitPath = path.join(directory, `gui${alvo.unit}.pak`);
const unitContent = await readFile(unitPath);

// Tipo de bloco de cada skill, herdado da arvore de classe.
const layoutClasse = parseSkillLayout(unitContent.subarray(classe.offset, classe.offset + classe.size).toString("latin1"));
const tipoPorSkill = new Map(layoutClasse.cells.filter((cell) => cell.tblidx !== null).map((cell) => [cell.tblidx as number, cell.kind]));

const layout = parseSkillLayout(unitContent.subarray(alvo.offset, alvo.offset + alvo.size).toString("latin1"));
const celulas = layout.cells.slice().sort((a, b) => a.column - b.column || a.row - b.row);

console.log(`árvore: ${alvo.name} (${layout.cells.length} células)\n`);
let faltando = 0;
const tipos = new Map<number, string>();
for (const tblidx of SKILLS) {
  const nome = nomeDaSkill(tblidx);
  const tipo = tipoPorSkill.get(tblidx) ?? "skill";
  tipos.set(tblidx, tipo);
  if (!nome) faltando += 1;
  console.log(`  ${nome ? "OK  " : "AUSENTE"} ${String(tblidx).padEnd(9)} bloco ${tipo.padEnd(6)} ${nome ?? "não existe no Table_Skill_Data.rdf"}`);
}
if (faltando) { console.log(`\n${faltando} TBLIDX não existe(m) no RDF; abortado.`); process.exit(1); }
if (new Set(SKILLS).size !== SKILLS.length) { console.log("\nHá TBLIDX repetido na lista; abortado."); process.exit(1); }

// Coloca em coluna, de cima para baixo, pulando para a proxima coluna ao encher.
const compativeis = celulas.filter((cell) => cell.kind === "skill" || tipos.has(cell.tblidx ?? -1));
if (compativeis.length < SKILLS.length) { console.log("\nNão há células suficientes; abortado."); process.exit(1); }

// Acrescenta sem remover: o que já estava na árvore fica onde está, e as skills novas
// ocupam as células livres seguintes.
const placements = new Map<string, number | null>(layout.cells.map((cell) => [`${cell.column},${cell.row}`, cell.tblidx]));
const jaPresentes = new Set(layout.cells.map((cell) => cell.tblidx).filter((t): t is number => t !== null));
const aAdicionar = SKILLS.filter((tblidx) => !jaPresentes.has(tblidx));
// Graus acima do primeiro que tenham sido colocados antes: saem da grade, porque o
// cliente chega neles por upgrade e nao por celula propria.
const aRemover = REMOVER[prefixo] ?? [];
for (const cell of layout.cells) if (cell.tblidx !== null && aRemover.includes(cell.tblidx)) placements.set(`${cell.column},${cell.row}`, null);
const livres = compativeis.filter((cell) => cell.tblidx === null);
if (livres.length < aAdicionar.length) { console.log("\nNão há células livres suficientes; abortado."); process.exit(1); }
aAdicionar.forEach((tblidx, i) => placements.set(`${livres[i].column},${livres[i].row}`, tblidx));
console.log(`\n${jaPresentes.size} já na árvore, ${aAdicionar.length} a acrescentar`);

// renderCell recusa tipo invalido; garantimos aqui que todo destino recebe um valido.
for (const [chave, tblidx] of placements) {
  if (tblidx === null) continue;
  const cell = layout.cells.find((c) => `${c.column},${c.row}` === chave)!;
  renderCell(cell, tblidx, tipos.get(tblidx) ?? "skill");
}

const texto = serializeSkillLayout(layout, placements, new Map(layout.lines.map((l) => [`${l.column},${l.row}`, null])));
const conteudo = Buffer.from(texto, "latin1");
const conferencia = parseSkillLayout(texto);
const ocupadas = conferencia.cells.filter((cell) => cell.tblidx !== null);

console.log(`\nverificações:`);
const removidas = aRemover.filter((tblidx) => jaPresentes.has(tblidx)).length;
const esperado = jaPresentes.size + aAdicionar.length - removidas;
if (removidas) console.log(`  ${removidas} grau(s) extra(s) retirado(s) da grade: ${aRemover.join(", ")}`);
console.log(`  ${ocupadas.length === esperado ? "OK  " : "FALHA"} ${ocupadas.length} skills na árvore (esperado ${esperado})`);
console.log(`  ${SKILLS.every((s) => ocupadas.some((c) => c.tblidx === s)) ? "OK  " : "FALHA"} todas as skills da lista estão na grade`);
console.log(`  ${conferencia.cells.length === layout.cells.length ? "OK  " : "FALHA"} nenhuma célula perdida`);
const tipoOk = ocupadas.every((cell) => cell.kind === (tipos.get(cell.tblidx!) ?? "skill"));
console.log(`  ${tipoOk ? "OK  " : "FALHA"} cada skill ficou com o bloco herdado da árvore de classe`);
if (ocupadas.length !== esperado || !tipoOk) process.exit(1);

console.log(`\ngrade resultante:`);
for (let row = 0; row < conferencia.rows; row += 1) {
  const linha = conferencia.cells.filter((c) => c.row === row).sort((a, b) => a.column - b.column)
    .map((c) => (c.tblidx === null ? "    ·    " : String(c.tblidx).padStart(9)));
  if (linha.join("").trim()) console.log(`  ${String(row).padStart(2)} |${linha.join("")}`);
}

if (!aplicar) { console.log("\n(simulação — rode com --apply para gravar)"); process.exit(0); }

const rebuilt = rebuildPackUnit({ index, records, unit: alvo.unit, unitContent, replacements: new Map([[alvo.name, conteudo]]) });
const backupDir = path.join(process.cwd(), "data", "skill-layout-backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const origem of [indicePath, unitPath]) {
  await copyFile(origem, path.join(backupDir, `${path.basename(origem)}.${stamp}.before-fill-${prefixo}.pak`));
}
await writeFile(unitPath, rebuilt.unitContent);
await writeFile(indicePath, encryptPackHeader(rebuilt.index));
console.log(`\ngravado. backup em data/skill-layout-backups/*.${stamp}.before-fill-${prefixo}.pak`);
