// Leitura e escrita dos .scr que desenham a arvore de skills do cliente
// (gui\skill\<classe>_skill.scr, dentro do gui.pak). Sem E/S, para poder ser exercido
// por scripts/check-skill-layout.ts.
//
// O arquivo tem duas secoes. Na primeira, cada celula da grade e um bloco:
//
//   //RC 0  3
//   skill 10111
//   {
//   x = 8 ;
//   y = 207 ;
//   mastery = FALSE;
//   base_skillIndex = 10111 ;
//   }
//
// Celula vazia e o mesmo bloco comentado com "@" no lugar do id. Na segunda secao ficam
// as setas, que o cliente posiciona sozinho a partir das duas skills que elas ligam --
// por isso mover uma skill nao exige mexer nas linhas.
//
// A escrita substitui apenas os trechos que mudaram, preservando o resto byte a byte.

export type LayoutCell = {
  column: number;
  row: number;
  /** Coordenada em pixels que o arquivo ja usava para esta celula. */
  x: number;
  y: number;
  /** Palavra do bloco: skill, skillupgrade, skilloption, htb. */
  kind: string;
  /** TBLIDX ocupando a celula, ou null se vazia. */
  tblidx: number | null;
  /** Trecho exato do bloco no arquivo original. */
  start: number;
  end: number;
};

/** Lados do icone onde uma seta pode encostar, como o cliente aceita. */
export const ATTACH_POSITIONS = ["up", "down", "Left", "right"] as const;
export const LINE_KINDS = ["UpgradeLine", "OptionLine"] as const;

export type LayoutLine = {
  column: number;
  row: number;
  /** UpgradeLine (seta reta) ou OptionLine (seta com cotovelo). Vazio = slot livre. */
  kind: string;
  name: string;
  beginSkill: number;
  endSkill: number;
  beginAttach: string;
  endAttach: string;
  /** false = slot comentado, disponivel para receber uma seta nova. */
  active: boolean;
  start: number;
  end: number;
};

export type SkillLayout = {
  source: string;
  cells: LayoutCell[];
  lines: LayoutLine[];
  columns: number;
  rows: number;
};

const LINE_SECTION = "// LINE INFO";
const EOL = "\r\n";

const num = (value: string | undefined) => (value === undefined ? null : Number.parseInt(value, 10));

/**
 * Palavras que o cliente aceita como bloco ativo (CSkillCustomizeParser::IsValidType).
 * Cada uma escolhe a TABELA onde o id sera procurado -- "skill" na tabela de skills,
 * "htb" na de HTB, "action" na de acoes. Por isso o tipo pertence a SKILL, nao a celula:
 * gravar um id de skill num bloco "htb" faz o cliente procurar na tabela errada e o
 * icone simplesmente nao aparece. "skillupgrade" e "skilloption" nao sao tipos validos;
 * so existem comentados no arquivo, como espaco reservado.
 */
export const ACTIVE_CELL_KINDS = ["skill", "htb", "action"] as const;

/** Bloco de celula, ativo ou comentado, no formato que o arquivo original usa. */
export function renderCell(cell: Pick<LayoutCell, "x" | "y" | "kind">, tblidx: number | null, kind = cell.kind) {
  if (tblidx === null) {
    return [`//${cell.kind}@`, "//{", `//x = ${cell.x} ;`, `//y = ${cell.y} ;`, "//mastery = FALSE;", "//base_skillIndex =@;", "//}"].join(EOL);
  }
  if (!(ACTIVE_CELL_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`"${kind}" não é um tipo de bloco que o cliente saiba carregar.`);
  }
  return [`${kind} ${tblidx} `, "{", `x = ${cell.x} ;`, `y = ${cell.y} ;`, "mastery = FALSE;", `base_skillIndex = ${tblidx} ;`, "}"].join(EOL);
}

export function parseSkillLayout(source: string): SkillLayout {
  const cutoff = source.indexOf(LINE_SECTION);
  const skillSection = cutoff < 0 ? source : source.slice(0, cutoff);

  const cells: LayoutCell[] = [];
  // Marcador da celula: "//RC c r" (a primeira usa a sigla da classe no lugar de RC).
  const cellMarker = /^\/\/(?:RC|[A-Z]{2,4})[ \t]+(\d+)[ \t]+(\d+)[ \t]*$/gm;
  for (let marker = cellMarker.exec(skillSection); marker; marker = cellMarker.exec(skillSection)) {
    const afterMarker = skillSection.indexOf("\n", marker.index) + 1;
    if (afterMarker <= 0) continue;

    const block = /^(\/\/)?(skill|skillupgrade|skilloption|htb)[ \t@]*(\d*)/.exec(skillSection.slice(afterMarker, afterMarker + 60));
    if (!block) continue;

    // O bloco vai ate a chave de fechamento, comentada ou nao.
    const closing = skillSection.indexOf(block[1] ? `//}` : `${EOL}}`, afterMarker);
    if (closing < 0) continue;
    const end = closing + (block[1] ? 3 : EOL.length + 1);

    const body = skillSection.slice(afterMarker, end);
    cells.push({
      column: Number(marker[1]),
      row: Number(marker[2]),
      x: num(/x = (\d+)/.exec(body)?.[1]) ?? 0,
      y: num(/y = (\d+)/.exec(body)?.[1]) ?? 0,
      kind: block[2],
      tblidx: block[1] || !block[3] ? null : Number(block[3]),
      start: afterMarker,
      end,
    });
  }

  // Os slots de seta ficam na segunda secao. Os comentados tambem sao lidos, porque sao
  // eles que recebem uma seta nova -- a quantidade de slots do arquivo e fixa.
  const lines: LayoutLine[] = [];
  if (cutoff >= 0) {
    const lineMarker = /^\/\/ RC[ \t]+(\d+)[ \t]+(\d+)[ \t]+(\S+)[ \t]*$/gm;
    for (let marker = lineMarker.exec(source); marker; marker = lineMarker.exec(source)) {
      if (marker.index < cutoff) continue;
      const afterMarker = source.indexOf("\n", marker.index) + 1;
      const block = /^(\/\/)?(UpgradeLine|OptionLine|@)[ \t]+(\S+)/.exec(source.slice(afterMarker, afterMarker + 60));
      if (!block) continue;

      const active = !block[1];
      const closing = source.indexOf(active ? `${EOL}}` : `//}`, afterMarker);
      if (closing < 0) continue;
      const end = closing + (active ? EOL.length + 1 : 3);
      const body = source.slice(afterMarker, end);
      lines.push({
        column: Number(marker[1]),
        row: Number(marker[2]),
        kind: active ? block[2] : "",
        name: block[3],
        beginSkill: (active && num(/begin_skill\s*=\s*(\d+)/.exec(body)?.[1])) || 0,
        endSkill: (active && num(/end_skill\s*=\s*(\d+)/.exec(body)?.[1])) || 0,
        beginAttach: (active && /begin_attachpos\s*=\s*([A-Za-z]+)/.exec(body)?.[1]) || "down",
        endAttach: (active && /end_attachpos\s*=\s*([A-Za-z]+)/.exec(body)?.[1]) || "up",
        active,
        // O marcador entra no trecho para o comentario acompanhar o bloco ao mudar.
        start: marker.index,
        end,
      });
    }
  }

  return {
    source,
    cells,
    lines,
    columns: cells.reduce((max, cell) => Math.max(max, cell.column + 1), 0),
    rows: cells.reduce((max, cell) => Math.max(max, cell.row + 1), 0),
  };
}

export type LineDefinition = { kind: string; beginSkill: number; endSkill: number; beginAttach: string; endAttach: string };

/** Bloco de seta, ativo ou comentado, incluindo o comentário marcador da célula. */
export function renderLine(line: Pick<LayoutLine, "column" | "row" | "name">, definition: LineDefinition | null) {
  const marker = `// RC ${line.column}  ${line.row} ${definition ? definition.kind : "@"} `;
  if (!definition) {
    return [marker, `//@ ${line.name}`, "//{", "//begin_skill =  0 ;", "//end_skill =  0 ;", "//begin_attachpos =  0 ;", "//end_attachpos =  0 ;", "//}"].join(EOL);
  }
  return [
    marker,
    `${definition.kind}  ${line.name}`,
    "{",
    `begin_skill =  ${definition.beginSkill} ;`,
    `end_skill =  ${definition.endSkill} ;`,
    `begin_attachpos = ${definition.beginAttach};`,
    `end_attachpos = ${definition.endAttach};`,
    "}",
  ].join(EOL);
}

/**
 * Reescreve o arquivo com a nova ocupacao das celulas e das setas. Ambos os mapas usam
 * "coluna,linha" como chave; `null` esvazia o slot. Chaves ausentes ficam como estao, e
 * todo o resto do arquivo e preservado byte a byte.
 *
 * As substituicoes sao aplicadas de tras para frente para que os offsets ja calculados
 * nao andem conforme o texto muda de tamanho.
 */
export function serializeSkillLayout(
  layout: SkillLayout,
  placements: Map<string, number | null>,
  linePlacements: Map<string, LineDefinition | null> = new Map(),
) {
  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];

  // O tipo do bloco acompanha a skill de onde ela veio, nunca a celula de destino.
  const kindPorSkill = new Map(layout.cells.filter((cell) => cell.tblidx !== null).map((cell) => [cell.tblidx as number, cell.kind]));

  for (const cell of layout.cells) {
    const tblidx = placements.get(`${cell.column},${cell.row}`);
    if (tblidx === undefined || tblidx === cell.tblidx) continue;
    edits.push({ start: cell.start, end: cell.end, text: renderCell(cell, tblidx, tblidx === null ? cell.kind : kindPorSkill.get(tblidx) ?? cell.kind) });
  }

  for (const line of layout.lines) {
    const chave = `${line.column},${line.row}`;
    if (!linePlacements.has(chave)) continue;
    const definition = linePlacements.get(chave) ?? null;
    const igual = definition
      ? line.active && line.kind === definition.kind && line.beginSkill === definition.beginSkill && line.endSkill === definition.endSkill && line.beginAttach === definition.beginAttach && line.endAttach === definition.endAttach
      : !line.active;
    if (igual) continue;
    edits.push({ start: line.start, end: line.end, text: renderLine(line, definition) });
  }

  let output = layout.source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}
