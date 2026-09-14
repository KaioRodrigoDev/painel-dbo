"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const CHARACTER_CLASSES = ["Lutador humano", "Místico humano", "Engenheiro humano", "Guerreiro Namek", "Místico Namek", "Mighty Majin", "Wonder Majin", "Street Fighter", "Sword Master", "Crane Roshi", "Turtle Roshi", "Gun Mania", "Mech Mania", "Dark Warrior", "Shadow Knight", "Dende Priest", "Poko Priest", "Ultimate Majin", "Grand Chef Majin", "Plasma Majin", "Karma Majin"];

// Precisa acompanhar .skillTreeGrid/.skillTreeCell no globals.css: a sobreposição das
// setas é desenhada em coordenadas calculadas a partir destes números.
const PAD = 14, CELL_W = 64, CELL_H = 58, GAP = 6;
const COL_PITCH = CELL_W + GAP, ROW_PITCH = CELL_H + GAP;

type LayoutClass = { classIndex: number; prefix: string; label: string | null };
type LayoutCell = { column: number; row: number; kind: string; tblidx: number | null };
type LineDefinition = { kind: string; beginSkill: number; endSkill: number; beginAttach: string; endAttach: string };
type LayoutLine = LineDefinition & { column: number; row: number; name: string; active: boolean };
type LayoutSkill = { tblidx: number; name: string; internalName: string; iconName: string; grade: number };
type SkillLayout = { classIndex: number; prefix: string; packedPath: string; columns: number; rows: number; cells: LayoutCell[]; lines: LayoutLine[]; skills: LayoutSkill[] };
type Change = { kind: "cell" | "line"; column: number; row: number; beforeName: string | null; afterName: string | null };
type Preview = { changes: Change[]; lineChanges: Change[]; blockingIssues: string[]; packDirectory: string };

const cellKey = (column: number, row: number) => `${column},${row}`;

export function SkillTreePanel() {
  const router = useRouter();
  const [classes, setClasses] = useState<LayoutClass[]>([]);
  const [classIndex, setClassIndex] = useState<number | null>(null);
  const [layout, setLayout] = useState<SkillLayout | null>(null);
  /** Ocupação da grade em edição: célula -> TBLIDX. */
  const [placement, setPlacement] = useState<Map<string, number | null>>(new Map());
  /** Setas em edição: slot -> definição, ou null para slot livre. */
  const [lines, setLines] = useState<Map<string, LineDefinition | null>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [packDirectory, setPackDirectory] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/skill-layout", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as { classes?: LayoutClass[]; error?: string };
        if (response.status === 401) { router.push("/login"); return; }
        if (!response.ok || !body.classes) throw new Error(body.error ?? "Não foi possível listar as classes.");
        setClasses(body.classes);
        if (body.classes.length) setClassIndex(body.classes[0].classIndex);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível listar as classes."); }
    })();
  }, [router]);

  // A busca vem antes de qualquer setState para o efeito abaixo não disparar renders em
  // cascata; o estado de carregamento é derivado, não guardado.
  const loadLayout = useCallback(async (target: number) => {
    try {
      const response = await fetch(`/api/skill-layout?class=${target}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { layout?: SkillLayout; error?: string };
      if (response.status === 401) { router.push("/login"); return; }
      if (!response.ok || !body.layout) throw new Error(body.error ?? "Não foi possível carregar a árvore.");
      setLayout(body.layout);
      setPlacement(new Map(body.layout.cells.map((cell) => [cellKey(cell.column, cell.row), cell.tblidx])));
      setLines(new Map(body.layout.lines.map((line) => [cellKey(line.column, line.row), line.active ? { kind: line.kind, beginSkill: line.beginSkill, endSkill: line.endSkill, beginAttach: line.beginAttach, endAttach: line.endAttach } : null])));
      setLinkFrom(null);
      setError(""); // a mensagem de sucesso da publicação sobrevive à recarga
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a árvore."); setLayout(null); }
  }, [router]);

  useEffect(() => {
    if (classIndex === null) return;
    void (async () => { await loadLayout(classIndex); })();
  }, [classIndex, loadLayout]);

  const loading = classIndex !== null && !layout && !error;
  const skillsPorTblidx = useMemo(() => new Map((layout?.skills ?? []).map((skill) => [skill.tblidx, skill])), [layout]);
  const cellsPorChave = useMemo(() => new Map((layout?.cells ?? []).map((cell) => [cellKey(cell.column, cell.row), cell])), [layout]);
  const linhasVisiveis = useMemo(() => [...new Set((layout?.cells ?? []).map((cell) => cell.row))].sort((a, b) => a - b), [layout]);

  const alterado = useMemo(() => {
    if (!layout) return false;
    const celulaMudou = layout.cells.some((cell) => placement.get(cellKey(cell.column, cell.row)) !== cell.tblidx);
    const setaMudou = layout.lines.some((line) => {
      const atual = lines.get(cellKey(line.column, line.row)) ?? null;
      if (!atual) return line.active;
      return !line.active || atual.kind !== line.kind || atual.beginSkill !== line.beginSkill || atual.endSkill !== line.endSkill || atual.beginAttach !== line.beginAttach || atual.endAttach !== line.endAttach;
    });
    return celulaMudou || setaMudou;
  }, [layout, placement, lines]);

  /** Onde cada skill está agora na grade, para desenhar as setas. */
  const posicaoDaSkill = useMemo(() => {
    const mapa = new Map<number, { column: number; rowIndex: number }>();
    for (const [key, tblidx] of placement) {
      if (tblidx === null) continue;
      const [column, row] = key.split(",").map(Number);
      const rowIndex = linhasVisiveis.indexOf(row);
      if (rowIndex >= 0) mapa.set(tblidx, { column, rowIndex });
    }
    return mapa;
  }, [placement, linhasVisiveis]);

  const centro = (posicao: { column: number; rowIndex: number }) => ({
    x: PAD + posicao.column * COL_PITCH + CELL_W / 2,
    y: PAD + posicao.rowIndex * ROW_PITCH + CELL_H / 2,
  });
  const ancora = (posicao: { column: number; rowIndex: number }, attach: string) => {
    const { x, y } = centro(posicao);
    if (attach === "up") return { x, y: y - CELL_H / 2 };
    if (attach === "down") return { x, y: y + CELL_H / 2 };
    if (attach === "Left") return { x: x - CELL_W / 2, y };
    return { x: x + CELL_W / 2, y };
  };

  /** Caminho ortogonal entre duas âncoras, no estilo das setas do jogo. */
  function caminho(line: LineDefinition) {
    const de = posicaoDaSkill.get(line.beginSkill);
    const para = posicaoDaSkill.get(line.endSkill);
    if (!de || !para) return null;
    const a = ancora(de, line.beginAttach);
    const b = ancora(para, line.endAttach);
    const saiVertical = line.beginAttach === "up" || line.beginAttach === "down";
    const pontos = saiVertical
      ? [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]
      : [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
    return pontos.map((ponto, index) => `${index ? "L" : "M"}${ponto.x} ${ponto.y}`).join(" ");
  }

  function moveSkill(from: string, to: string) {
    if (from === to) return;
    setPlacement((atual) => {
      const proximo = new Map(atual);
      const origem = proximo.get(from) ?? null;
      proximo.set(from, proximo.get(to) ?? null);
      proximo.set(to, origem);
      return proximo;
    });
  }

  /** Segundo clique no modo de ligação: cria a seta no primeiro slot livre. */
  function conectar(destino: number) {
    if (linkFrom === null || linkFrom === destino) { setLinkFrom(null); return; }
    const de = posicaoDaSkill.get(linkFrom);
    const para = posicaoDaSkill.get(destino);
    if (!de || !para) { setLinkFrom(null); return; }

    const slotLivre = (layout?.lines ?? []).find((line) => !(lines.get(cellKey(line.column, line.row)) ?? null));
    if (!slotLivre) { setError("Não há slot de seta livre neste arquivo."); setLinkFrom(null); return; }

    // Mesma coluna e abaixo = seta reta; qualquer outro arranjo pede o cotovelo.
    const reta = de.column === para.column && para.rowIndex > de.rowIndex;
    const definition: LineDefinition = reta
      ? { kind: "UpgradeLine", beginSkill: linkFrom, endSkill: destino, beginAttach: "down", endAttach: "up" }
      : { kind: "OptionLine", beginSkill: linkFrom, endSkill: destino, beginAttach: para.column > de.column ? "right" : "Left", endAttach: "up" };

    setLines((atual) => new Map(atual).set(cellKey(slotLivre.column, slotLivre.row), definition));
    setLinkFrom(null);
  }

  function removerSeta(key: string) { setLines((atual) => new Map(atual).set(key, null)); }
  function ajustarSeta(key: string, patch: Partial<LineDefinition>) {
    setLines((atual) => {
      const alvo = atual.get(key);
      return alvo ? new Map(atual).set(key, { ...alvo, ...patch }) : atual;
    });
  }

  const corpo = () => ({
    classIndex,
    placements: [...placement].map(([key, tblidx]) => ({ column: Number(key.split(",")[0]), row: Number(key.split(",")[1]), tblidx })),
    lines: [...lines].map(([key, line]) => ({ column: Number(key.split(",")[0]), row: Number(key.split(",")[1]), line })),
    clientPackDirectory: packDirectory || null,
  });

  async function validate() {
    if (classIndex === null || !layout) return;
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/skill-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo()) });
      const body = (await response.json().catch(() => ({}))) as { preview?: Preview; error?: string };
      if (response.status === 401) { router.push("/login"); return; }
      if (!response.ok || !body.preview) throw new Error(body.error ?? "Não foi possível validar.");
      setPreview(body.preview);
      if (!packDirectory) setPackDirectory(body.preview.packDirectory);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível validar."); }
  }

  async function confirmPublication() {
    if (classIndex === null || !preview || preview.blockingIssues.length) return;
    setPublishing(true); setError("");
    try {
      const response = await fetch("/api/skill-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...corpo(), confirm: true }) });
      const body = (await response.json().catch(() => ({}))) as { result?: { packFile: string; backups: string[] }; error?: string };
      if (response.status === 401) { router.push("/login"); return; }
      if (!response.ok || !body.result) throw new Error(body.error ?? "Não foi possível publicar.");
      setMessage(`Árvore publicada em ${body.result.packFile}. Backup: ${body.result.backups.length} arquivo(s). Feche e abra o cliente para ver.`);
      setPreview(null);
      await loadLayout(classIndex);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível publicar."); }
    finally { setPublishing(false); }
  }

  const setasAtivas = useMemo(() => [...lines].filter(([, line]) => line !== null) as [string, LineDefinition][], [lines]);
  const alturaGrade = PAD * 2 + linhasVisiveis.length * ROW_PITCH;
  const larguraGrade = PAD * 2 + (layout?.columns ?? 0) * COL_PITCH;

  return <div className="skillTreePanel">
    <div className="skillTreeToolbar">
      <label><span>Classe</span>
        <select value={classIndex ?? ""} onChange={(event) => { setLayout(null); setClassIndex(Number(event.target.value)); }} disabled={loading || !classes.length}>
          {classes.map((entry) => <option key={entry.classIndex} value={entry.classIndex}>{entry.label ?? CHARACTER_CLASSES[entry.classIndex] ?? `Classe `} ({entry.prefix})</option>)}
        </select>
      </label>
      {layout && <span className="muted">{layout.packedPath} · {layout.skills.length} skills · {setasAtivas.length} setas</span>}
      <div className="skillTreeActions">
        <button type="button" className={linkMode ? "publishDraftButton" : "catalogClearButton"} onClick={() => { setLinkMode((atual) => !atual); setLinkFrom(null); }} disabled={!layout}>
          {linkMode ? "Sair do modo seta" : "Ligar skills"}
        </button>
        {alterado && <button type="button" className="catalogClearButton" onClick={() => classIndex !== null && void loadLayout(classIndex)}>Descartar</button>}
        <button type="button" className="publishDraftButton" disabled={!alterado || loading} onClick={() => void validate()}>Validar e publicar</button>
      </div>
    </div>

    {linkMode && <div className="publishWarnings"><span>⚠ {linkFrom === null ? "Clique na skill de origem da seta." : `Origem: ${skillsPorTblidx.get(linkFrom)?.name ?? linkFrom}. Agora clique no destino.`}</span></div>}
    {error && <div className="errorBanner"><strong>Erro</strong><span>{error}</span></div>}
    {message && <div className="successBanner"><strong>Publicado</strong><span>{message}</span></div>}

    {loading ? <p className="muted">Carregando árvore...</p> : !layout ? <p className="muted">Selecione uma classe.</p> : <div className="skillTreeGridWrap">
      <div className={`skillTreeGrid${linkMode ? " linking" : ""}`} style={{ width: larguraGrade, height: alturaGrade }}>
        <svg className="skillTreeArrows" width={larguraGrade} height={alturaGrade} aria-hidden="true">
          <defs><marker id="skillArrowHead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="var(--gold)" /></marker></defs>
          {setasAtivas.map(([key, line]) => {
            const d = caminho(line);
            return d ? <path key={key} d={d} className={`skillTreeArrow${line.kind === "OptionLine" ? " elbow" : ""}`} markerEnd="url(#skillArrowHead)" /> : null;
          })}
        </svg>
        {layout.cells.map((cell) => {
          const key = cellKey(cell.column, cell.row);
          const tblidx = placement.get(key) ?? null;
          const skill = tblidx === null ? null : skillsPorTblidx.get(tblidx);
          const mudou = cellsPorChave.get(key)?.tblidx !== tblidx;
          const rowIndex = linhasVisiveis.indexOf(cell.row);
          return <div
            key={key}
            className={`skillTreeCell${skill ? " filled" : ""}${mudou ? " changed" : ""}${hovered === key ? " hovered" : ""}${linkFrom !== null && linkFrom === tblidx ? " linkSource" : ""}${cell.kind !== "skill" ? " special" : ""}`}
            style={{ left: PAD + cell.column * COL_PITCH, top: PAD + rowIndex * ROW_PITCH }}
            draggable={Boolean(skill) && !linkMode}
            onDragStart={() => setDragging(key)}
            onDragEnd={() => { setDragging(null); setHovered(null); }}
            onDragOver={(event) => { event.preventDefault(); setHovered(key); }}
            onDragLeave={() => setHovered((atual) => (atual === key ? null : atual))}
            onDrop={(event) => { event.preventDefault(); if (dragging) moveSkill(dragging, key); setDragging(null); setHovered(null); }}
            onClick={() => { if (linkMode && tblidx !== null) { if (linkFrom === null) setLinkFrom(tblidx); else conectar(tblidx); } }}
            title={skill ? `${skill.name} · #${skill.tblidx} · grau ${skill.grade} · bloco ${cell.kind}` : `Célula vazia (${cell.column}, ${cell.row}) · bloco ${cell.kind}`}
          >
            {skill && skill.iconName
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/api/skills/icons/${encodeURIComponent(skill.iconName)}`} alt={skill.name} draggable={false} />
              : skill ? <span className="skillTreeFallback">{skill.tblidx}</span> : null}
          </div>;
        })}
      </div>

      <div className="skillTreeLegend">
        <strong>Setas ({setasAtivas.length})</strong>
        {!setasAtivas.length && <small className="muted">Nenhuma seta. Use &quot;Ligar skills&quot; para criar.</small>}
        {setasAtivas.map(([key, line]) => <div key={key} className="skillTreeArrowRow">
          <span>{skillsPorTblidx.get(line.beginSkill)?.name ?? `#${line.beginSkill}`} → {skillsPorTblidx.get(line.endSkill)?.name ?? `#${line.endSkill}`}</span>
          <div>
            <select value={line.kind} onChange={(event) => ajustarSeta(key, { kind: event.target.value })} title="Formato da seta">
              <option value="UpgradeLine">reta</option><option value="OptionLine">cotovelo</option>
            </select>
            <select value={line.beginAttach} onChange={(event) => ajustarSeta(key, { beginAttach: event.target.value })} title="Sai de">
              {["up", "down", "Left", "right"].map((pos) => <option key={pos} value={pos}>sai {pos}</option>)}
            </select>
            <select value={line.endAttach} onChange={(event) => ajustarSeta(key, { endAttach: event.target.value })} title="Chega em">
              {["up", "down", "Left", "right"].map((pos) => <option key={pos} value={pos}>chega {pos}</option>)}
            </select>
            <button type="button" onClick={() => removerSeta(key)} title="Remover seta">×</button>
          </div>
        </div>)}
        <small className="muted">O cliente desenha a seta entre as duas skills, então mover um ícone já a reposiciona. O desenho aqui é uma aproximação do caminho.</small>
      </div>
    </div>}

    {preview && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (!publishing && event.target === event.currentTarget) setPreview(null); }}>
      <section className="editorModal skillPublishModal" role="dialog" aria-modal="true" aria-labelledby="layout-publish-title">
        <div className="modalHeader"><div><div className="eyebrow">CONFIRMAÇÃO OBRIGATÓRIA</div><h2 id="layout-publish-title">Publicar árvore de {CHARACTER_CLASSES[classIndex ?? 0]}</h2><p>{layout?.packedPath}</p></div>
          <button className="closeButton" disabled={publishing} onClick={() => setPreview(null)} aria-label="Fechar">×</button></div>
        <div className="publishChangeList"><div className="publishChangeHeader"><strong>Alterações</strong><span>{preview.changes.length + preview.lineChanges.length}</span></div>
          {[...preview.changes, ...preview.lineChanges].map((change) => <div key={`${change.kind}-${change.column},${change.row}`}>
            <span><strong>{change.kind === "line" ? "Seta" : "Célula"} {change.column}, {change.row}</strong></span>
            <code>{change.beforeName ?? "vazia"}</code><b>→</b><code>{change.afterName ?? "vazia"}</code>
          </div>)}
        </div>
        {preview.blockingIssues.length > 0 && <div className="errorBanner"><strong>Publicação bloqueada</strong><span>{preview.blockingIssues.join(" ")}</span></div>}
        <div className="publishClientOptions"><strong>Destino</strong>
          <label className="publishPackPath"><span>Pasta pack do cliente</span>
            <input type="text" value={packDirectory} onChange={(event) => setPackDirectory(event.target.value)} spellCheck={false} /></label>
          <small className="muted">O gui.pak e a unidade de dados são regravados, com backup de ambos antes.</small>
        </div>
        <div className="modalActions">
          <button className="catalogClearButton" type="button" disabled={publishing} onClick={() => setPreview(null)}>Cancelar</button>
          <button className="dangerPublishButton" type="button" disabled={publishing || preview.blockingIssues.length > 0} onClick={() => void confirmPublication()}>{publishing ? "Publicando..." : "Confirmar publicação"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
