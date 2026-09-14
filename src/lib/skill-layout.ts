import "server-only";

import path from "node:path";

import { loadPackIndex, resolveClientPackDirectory } from "@/lib/pack-index";
import { readPackFileContent, replacePackFiles } from "@/lib/pack-writer";
import { loadSkillCatalog } from "@/lib/skill-catalog";
import { parseSkillLayout, serializeSkillLayout, type LayoutLine, type LineDefinition } from "@/lib/skill-layout-format";

const HEADER_FILE = "gui.pak";

// Arquivo de arvore por classe, conforme CSkillCustomizeGui::GenerateSkillItems.
// O indice segue a ordem de ePC_CLASS, a mesma que o painel ja usa em CHARACTER_CLASSES.
const CLASS_FILES: { classIndex: number; prefix: string; suffix?: string; label?: string }[] = [
  { classIndex: 0, prefix: "hfi" }, { classIndex: 1, prefix: "hmy" }, { classIndex: 2, prefix: "hen" },
  { classIndex: 3, prefix: "nfi" }, { classIndex: 4, prefix: "nmy" }, { classIndex: 5, prefix: "mmi" },
  { classIndex: 6, prefix: "mwo" }, { classIndex: 7, prefix: "hsf" }, { classIndex: 8, prefix: "hsm" },
  { classIndex: 9, prefix: "hcr" }, { classIndex: 10, prefix: "htr" }, { classIndex: 11, prefix: "hgm" },
  { classIndex: 12, prefix: "hmm" }, { classIndex: 13, prefix: "ndw" }, { classIndex: 14, prefix: "nsk" },
  { classIndex: 15, prefix: "ndh" }, { classIndex: 16, prefix: "nps" }, { classIndex: 17, prefix: "mul" },
  { classIndex: 18, prefix: "mgr" }, { classIndex: 19, prefix: "mpl" }, { classIndex: 20, prefix: "mkr" },
  // Arvores de transformacao: uma por CLASSE BASE, porque a transformacao e especifica
  // de cada classe. Sao os 6 ramos que o cliente realmente preenche -- o de Engenheiro
  // humano esta vazio no original. Usam indices fora da faixa de ePC_CLASS e rotulo
  // proprio, ja que nao sao a arvore de skills daquela classe.
  { classIndex: 100, prefix: "hfi", suffix: "transform", label: "Transformações — Lutador humano" },
  { classIndex: 101, prefix: "hmy", suffix: "transform", label: "Transformações — Místico humano" },
  { classIndex: 102, prefix: "nfi", suffix: "transform", label: "Transformações — Guerreiro Namek" },
  { classIndex: 103, prefix: "nmy", suffix: "transform", label: "Transformações — Místico Namek" },
  { classIndex: 104, prefix: "mmi", suffix: "transform", label: "Transformações — Mighty Majin" },
  { classIndex: 105, prefix: "mwo", suffix: "transform", label: "Transformações — Wonder Majin" },
  // A arvore de acao e a unica realmente comum a todas as classes.
  { classIndex: 110, prefix: "action", suffix: "skill", label: "Action (todas as classes)" },
];

export const packedPathForClass = (prefix: string, suffix = "skill") => `.\\gui\\skill\\${prefix}_${suffix}.scr`;

export type LayoutSkill = { tblidx: number; name: string; internalName: string; iconName: string; grade: number };
export type LayoutCellView = { column: number; row: number; kind: string; tblidx: number | null };
export type SkillLayoutView = {
  classIndex: number;
  prefix: string;
  packedPath: string;
  columns: number;
  rows: number;
  cells: LayoutCellView[];
  lines: LayoutLine[];
  skills: LayoutSkill[];
};

/** Classes cujo arquivo de árvore existe de fato no gui.pak deste cliente. */
export async function listSkillLayoutClasses(directory = resolveClientPackDirectory()) {
  const entries = await loadPackIndex(HEADER_FILE, directory);
  return CLASS_FILES.filter((entry) => entries.has(packedPathForClass(entry.prefix, entry.suffix).toLowerCase())).map((entry) => ({
    classIndex: entry.classIndex,
    prefix: entry.prefix.toUpperCase(),
    label: entry.label ?? null,
  }));
}

function classEntry(classIndex: number) {
  const entry = CLASS_FILES.find((candidate) => candidate.classIndex === classIndex);
  if (!entry) throw new Error(`Classe ${classIndex} não possui árvore de skills.`);
  return entry;
}

export async function loadSkillLayout(classIndex: number, directory = resolveClientPackDirectory()): Promise<SkillLayoutView> {
  const entry = classEntry(classIndex);
  const packedPath = packedPathForClass(entry.prefix, entry.suffix);
  const source = (await readPackFileContent(HEADER_FILE, packedPath, directory)).toString("latin1");
  const layout = parseSkillLayout(source);

  // Dados de exibicao (nome e icone) vem do RDF do servidor, nao do .scr.
  const catalog = await loadSkillCatalog();
  const porTblidx = new Map(catalog.skills.map((skill) => [skill.tblidx, skill]));
  const usados = new Set(layout.cells.map((cell) => cell.tblidx).filter((tblidx): tblidx is number => tblidx !== null));

  return {
    classIndex,
    prefix: entry.prefix.toUpperCase(),
    packedPath,
    columns: layout.columns,
    rows: layout.rows,
    cells: layout.cells.map((cell) => ({ column: cell.column, row: cell.row, kind: cell.kind, tblidx: cell.tblidx })),
    lines: layout.lines,
    skills: [...usados].map((tblidx) => {
      const skill = porTblidx.get(tblidx);
      return {
        tblidx,
        name: skill?.name || skill?.internalName || `Skill ${tblidx}`,
        internalName: skill?.internalName ?? "",
        iconName: skill?.iconName ?? "",
        grade: skill?.grade ?? 0,
      };
    }),
  };
}

export type LayoutPlacement = { column: number; row: number; tblidx: number | null };
export type LayoutLinePlacement = { column: number; row: number; line: LineDefinition | null };

const chave = (entry: { column: number; row: number }) => `${entry.column},${entry.row}`;

/** Diferenças entre o arquivo atual e o que foi enviado, para o modal de confirmação. */
export async function previewSkillLayout(
  classIndex: number,
  placements: LayoutPlacement[],
  linePlacements: LayoutLinePlacement[] = [],
  directory = resolveClientPackDirectory(),
) {
  const layout = await loadSkillLayout(classIndex, directory);
  const atual = new Map(layout.cells.map((cell) => [chave(cell), cell.tblidx]));
  const nomes = new Map(layout.skills.map((skill) => [skill.tblidx, skill.name]));
  const nome = (tblidx: number | null) => (tblidx === null ? null : nomes.get(tblidx) ?? `#${tblidx}`);

  const changes = placements
    .filter((placement) => atual.get(chave(placement)) !== placement.tblidx)
    .map((placement) => ({
      kind: "cell" as const,
      column: placement.column,
      row: placement.row,
      before: atual.get(chave(placement)) ?? null,
      after: placement.tblidx,
      beforeName: nome(atual.get(chave(placement)) ?? null),
      afterName: nome(placement.tblidx),
    }));

  const linhasAtuais = new Map(layout.lines.map((line) => [chave(line), line]));
  const descreve = (line: LineDefinition | null) => (line ? `${line.kind === "UpgradeLine" ? "reta" : "cotovelo"} ${nome(line.beginSkill)} → ${nome(line.endSkill)}` : null);
  const lineChanges = linePlacements
    .filter((placement) => {
      const atualLinha = linhasAtuais.get(chave(placement));
      if (!atualLinha) return false;
      if (!placement.line) return atualLinha.active;
      return (
        !atualLinha.active || atualLinha.kind !== placement.line.kind || atualLinha.beginSkill !== placement.line.beginSkill ||
        atualLinha.endSkill !== placement.line.endSkill || atualLinha.beginAttach !== placement.line.beginAttach || atualLinha.endAttach !== placement.line.endAttach
      );
    })
    .map((placement) => {
      const atualLinha = linhasAtuais.get(chave(placement))!;
      return {
        kind: "line" as const,
        column: placement.column,
        row: placement.row,
        beforeName: atualLinha.active ? descreve(atualLinha) : null,
        afterName: descreve(placement.line),
      };
    });

  const ocupacao = placements.filter((placement) => placement.tblidx !== null).map((placement) => placement.tblidx);
  const naGrade = new Set(placements.filter((placement) => placement.tblidx !== null).map((placement) => placement.tblidx));
  const blockingIssues: string[] = [];
  if (new Set(ocupacao).size !== ocupacao.length) blockingIssues.push("A mesma skill aparece em mais de uma célula.");
  for (const placement of placements) {
    if (!atual.has(chave(placement))) blockingIssues.push(`A célula ${placement.column},${placement.row} não existe no arquivo.`);
  }
  for (const placement of linePlacements) {
    if (!linhasAtuais.has(chave(placement))) blockingIssues.push(`O slot de seta ${placement.column},${placement.row} não existe no arquivo.`);
    // Seta apontando para skill fora da grade nunca seria desenhada pelo cliente.
    if (placement.line && (!naGrade.has(placement.line.beginSkill) || !naGrade.has(placement.line.endSkill))) {
      blockingIssues.push(`A seta em ${placement.column},${placement.row} liga uma skill que não está na grade.`);
    }
  }
  if (!changes.length && !lineChanges.length) blockingIssues.push("O layout atual já é igual ao enviado.");

  return { layout, changes, lineChanges, blockingIssues };
}

export async function publishSkillLayout(
  classIndex: number,
  placements: LayoutPlacement[],
  linePlacements: LayoutLinePlacement[],
  options: { backupDirectory: string; label: string; directory?: string },
) {
  const directory = options.directory ?? resolveClientPackDirectory();
  const entry = classEntry(classIndex);
  const packedPath = packedPathForClass(entry.prefix, entry.suffix);

  const { blockingIssues } = await previewSkillLayout(classIndex, placements, linePlacements, directory);
  if (blockingIssues.length) throw new Error(blockingIssues.join(" "));

  const source = (await readPackFileContent(HEADER_FILE, packedPath, directory)).toString("latin1");
  const layout = parseSkillLayout(source);
  const serialized = serializeSkillLayout(
    layout,
    new Map(placements.map((placement) => [chave(placement), placement.tblidx])),
    new Map(linePlacements.map((placement) => [chave(placement), placement.line])),
  );

  const result = await replacePackFiles(HEADER_FILE, [{ packedPath, content: Buffer.from(serialized, "latin1") }], {
    directory,
    backupDirectory: options.backupDirectory,
    label: options.label,
  });

  return { packedPath, packDirectory: directory, packFile: path.basename(result.units[0]?.packPath ?? ""), backups: result.backups, files: result.files };
}
