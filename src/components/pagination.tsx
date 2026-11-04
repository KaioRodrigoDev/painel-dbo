"use client";

import { type FormEvent, useState } from "react";

/**
 * Páginas visíveis: a primeira, a última e duas de cada lado da atual; o resto vira "…".
 * Ex.: página 10 de 123 → 1 … 8 9 10 11 12 … 123.
 */
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  const pages = new Set([1, totalPages]);
  for (let offset = -2; offset <= 2; offset += 1) {
    const candidate = page + offset;
    if (candidate >= 1 && candidate <= totalPages) pages.add(candidate);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  for (const [index, value] of sorted.entries()) {
    const previous = sorted[index - 1];
    // Um buraco de uma página só vale mais mostrar o número do que "…".
    if (previous !== undefined && value - previous === 2) result.push(previous + 1);
    else if (previous !== undefined && value - previous > 2) result.push("gap");
    result.push(value);
  }
  return result;
}

/** Paginação comum do painel: primeira, anterior, números, próxima, última e "ir para". */
export function Pagination({ page, totalPages, onChange, disabled = false, label = "Paginação" }: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [draft, setDraft] = useState("");
  if (totalPages <= 1) return null;

  const go = (target: number) => {
    const clamped = Math.min(totalPages, Math.max(1, Math.trunc(target)));
    if (clamped !== page) onChange(clamped);
  };
  function jump(event: FormEvent) {
    event.preventDefault();
    const target = Number(draft);
    if (draft.trim() && Number.isFinite(target)) go(target);
    setDraft("");
  }

  return <nav className="pagination" aria-label={label}>
    <div className="paginationPages">
      <button type="button" disabled={disabled || page <= 1} onClick={() => go(1)} title="Primeira página" aria-label="Primeira página">«</button>
      <button type="button" disabled={disabled || page <= 1} onClick={() => go(page - 1)} title="Página anterior" aria-label="Página anterior">‹</button>
      {pageWindow(page, totalPages).map((entry, index) => entry === "gap"
        ? <span key={`gap${index}`} className="paginationGap" aria-hidden="true">…</span>
        : <button key={entry} type="button" className={entry === page ? "active" : ""} aria-current={entry === page ? "page" : undefined}
            disabled={disabled} onClick={() => go(entry)}>{entry}</button>)}
      <button type="button" disabled={disabled || page >= totalPages} onClick={() => go(page + 1)} title="Próxima página" aria-label="Próxima página">›</button>
      <button type="button" disabled={disabled || page >= totalPages} onClick={() => go(totalPages)} title={`Última página (${totalPages})`} aria-label="Última página">»</button>
    </div>
    <form className="paginationJump" onSubmit={jump}>
      <label><span>Ir para</span>
        <input type="number" min={1} max={totalPages} value={draft} placeholder={String(page)} disabled={disabled}
          onChange={(event) => setDraft(event.target.value)} aria-label={`Ir para a página (1 a ${totalPages})`} /></label>
      <span>de {totalPages}</span>
      <button type="submit" disabled={disabled || !draft.trim()}>Ir</button>
    </form>
  </nav>;
}
