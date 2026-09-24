"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { SkillFieldOption, SystemEffectEntry } from "@/lib/types";

/**
 * O valor gravado quando o campo está vazio.
 *
 * Confirmado na tabela: `Root_Skill`, `dwNextSkillTblidx` e as quatro posições de
 * pré-requisito usam sempre `INVALID_TBLIDX` para "nenhum" -- zero não aparece em nenhuma
 * das 2.838 skills. Por isso limpar um campo grava este valor, e não 0.
 */
export const EMPTY_REFERENCE = 4294967295;
export const isEmptyReference = (value: number) => value === EMPTY_REFERENCE || value === 0;

export type ResolvedSkill = { tblidx: number; name: string; iconName: string; grade: number; requiredLevel: number };

function RefIcon({ iconName }: { iconName: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconName || failed) return <span className="dropItemIcon">—</span>;
  return <span className="dropItemIcon"><Image src={`/api/skills/icons/${encodeURIComponent(iconName)}`} alt="" width={26} height={26} unoptimized onError={() => setFailed(true)} /></span>;
}

/**
 * Escolhe uma skill pelo nome, no lugar de digitar o TBLIDX.
 *
 * Mostra o que já está gravado com nome, ícone e grade, busca no catálogo inteiro (não só na
 * família carregada na tela, porque um pré-requisito pode apontar para fora dela) e tem um
 * botão para limpar.
 */
export function SkillReferencePicker({ value, resolved, label, onPick, onResolve }: {
  value: number;
  resolved: Map<number, ResolvedSkill>;
  label: string;
  onPick: (tblidx: number) => void;
  onResolve: (skill: ResolvedSkill) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ResolvedSkill[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setOptions([]); setOpen(false); return; }
      setSearching(true);
      try {
        const response = await fetch(`/api/skills?search=${encodeURIComponent(search.trim())}&page=1`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        setOptions((body.skills as ResolvedSkill[]).slice(0, 20));
        setOpen(true);
      } catch { /* busca abortada */ }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  const current = isEmptyReference(value) ? null : resolved.get(value);
  // 255 é INVALID_BYTE em byRequire_Train_Level: a skill não exige nível. Escrever "nível 255"
  // faz parecer defeito justamente onde o campo está dizendo "sem exigência".
  const levelText = current ? (current.requiredLevel === 255 ? "sem exigência de nível" : `nível ${current.requiredLevel}`) : "";
  return <div className="skillRefPicker">
    <div className="skillRefCurrent">
      <RefIcon iconName={current?.iconName ?? ""} />
      <div>
        <strong>{isEmptyReference(value) ? "Nenhuma" : current?.name ?? `Skill #${value}`}</strong>
        <small>{isEmptyReference(value) ? "campo vazio" : `#${value}${current ? ` · grade ${current.grade} · ${levelText}` : " · não encontrada no catálogo"}`}</small>
      </div>
      {!isEmptyReference(value) && <button type="button" className="skillRefClear" onClick={() => onPick(EMPTY_REFERENCE)} aria-label={`Limpar ${label}`}>×</button>}
    </div>
    <div className="dropSlotSearch">
      <input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => options.length && setOpen(true)}
        placeholder={`Buscar skill para ${label}`} maxLength={80} aria-label={label} />
      {searching && <span className="dropSlotSearching">…</span>}
      {open && options.length > 0 && <ul className="dropSlotOptions">
        {options.map((option) => <li key={option.tblidx}>
          <button type="button" onClick={() => { onResolve(option); onPick(option.tblidx); setOpen(false); setSearch(""); }}>
            <RefIcon iconName={option.iconName} />
            <span>{option.name} · grade {option.grade}</span>
            <code>{option.tblidx}</code>
          </button>
        </li>)}
      </ul>}
    </div>
  </div>;
}

/**
 * Os quatro TBLIDX de `uiRequire_Skill_Tblidx_[Min/Max]_[1/2]`.
 *
 * Não é uma lista de quatro skills soltas: são dois pares, e cada par delimita a faixa de
 * grades exigida -- "da grade X até a grade Y desta família". Mostrar como quatro caixas
 * numeradas escondia essa estrutura, que é justamente o que o operador precisa entender para
 * montar a dependência certa.
 */
export function PrerequisiteEditor({ ids, resolved, changed, onChange, onResolve }: {
  ids: number[];
  resolved: Map<number, ResolvedSkill>;
  changed: boolean;
  onChange: (ids: number[]) => void;
  onResolve: (skill: ResolvedSkill) => void;
}) {
  const normalized = Array.from({ length: 4 }, (_, index) => (Number.isFinite(ids[index]) ? ids[index] : EMPTY_REFERENCE));
  const set = (index: number, tblidx: number) => {
    const next = [...normalized];
    next[index] = tblidx;
    onChange(next);
  };

  return <fieldset className={`draftField skillPrereqField${changed ? " changed" : ""}`}>
    <legend>Skills pré-requisito</legend>
    <p className="dropNote">Cada par delimita uma faixa de grades exigida. Deixar os dois vazios remove a exigência.</p>
    {[0, 1].map((pair) => {
      const minIndex = pair * 2;
      const maxIndex = pair * 2 + 1;
      const empty = isEmptyReference(normalized[minIndex]) && isEmptyReference(normalized[maxIndex]);
      return <div className="skillPrereqPair" key={pair}>
        <div className="skillPrereqHead">
          <strong>Pré-requisito {pair + 1}</strong>
          {empty ? <span className="catalogBadge">sem exigência</span> : <button type="button" className="skillRefClear" onClick={() => { const next = [...normalized]; next[minIndex] = EMPTY_REFERENCE; next[maxIndex] = EMPTY_REFERENCE; onChange(next); }}>Limpar par</button>}
        </div>
        <div className="skillPrereqRow">
          <div><span>Da grade</span><SkillReferencePicker value={normalized[minIndex]} resolved={resolved} label={`mínimo ${pair + 1}`} onPick={(tblidx) => set(minIndex, tblidx)} onResolve={onResolve} /></div>
          <div><span>Até a grade</span><SkillReferencePicker value={normalized[maxIndex]} resolved={resolved} label={`máximo ${pair + 1}`} onPick={(tblidx) => set(maxIndex, tblidx)} onResolve={onResolve} /></div>
        </div>
      </div>;
    })}
    <small>uiRequire_Skill_Tblidx_[Min/Max]_[1/2] · vazio grava {EMPTY_REFERENCE}</small>
  </fieldset>;
}

/** Escolhe um efeito de Table_System_Effect_Data pelo nome, no lugar do TBLIDX. */
export function SystemEffectPicker({ value, resolved, onPick, onResolve }: {
  value: number;
  resolved: Map<number, SystemEffectEntry>;
  onPick: (tblidx: number) => void;
  onResolve: (effect: SystemEffectEntry) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<SystemEffectEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setOptions([]); setOpen(false); return; }
      try {
        const response = await fetch(`/api/system-effects?search=${encodeURIComponent(search.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        setOptions((body.effects as SystemEffectEntry[]).slice(0, 20));
        setOpen(true);
      } catch { /* busca abortada */ }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  const current = isEmptyReference(value) ? null : resolved.get(value);
  return <div className="skillRefPicker">
    <div className="skillRefCurrent">
      <div>
        <strong>{isEmptyReference(value) ? "Nenhum efeito" : current?.name ?? `Efeito #${value}`}</strong>
        <small>{isEmptyReference(value) ? "posição vazia" : `#${value}${current ? "" : " · não encontrado na tabela"}`}</small>
      </div>
      {!isEmptyReference(value) && <button type="button" className="skillRefClear" onClick={() => onPick(EMPTY_REFERENCE)} aria-label="Limpar efeito">×</button>}
    </div>
    <div className="dropSlotSearch">
      <input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => options.length && setOpen(true)}
        placeholder="Buscar efeito por nome" maxLength={80} aria-label="Efeito do sistema" />
      {open && options.length > 0 && <ul className="dropSlotOptions">
        {options.map((option) => <li key={option.tblidx}>
          <button type="button" onClick={() => { onResolve(option); onPick(option.tblidx); setOpen(false); setSearch(""); }}>
            <span>{option.name}</span>
            <code>{option.tblidx}</code>
          </button>
        </li>)}
      </ul>}
    </div>
  </div>;
}

/**
 * Campo numérico sem enum no servidor, apresentado com os valores que a tabela realmente usa.
 *
 * A lista vem de `/api/skills/field-options`, com quantas skills usam cada valor e um exemplo.
 * Mantém a caixa de número ao lado porque nada impede um valor novo -- mas assim escolher um
 * valor existente vira o caminho normal, e inventar um vira a exceção consciente.
 */
export function DerivedOptionField({ label, sourceField, help, value, options, changed, onChange }: {
  label: string;
  sourceField: string;
  help?: string;
  value: number;
  options: SkillFieldOption[];
  changed: boolean;
  onChange: (value: string) => void;
}) {
  const known = options.some((option) => option.value === value);
  return <label className={changed ? "draftField changed" : "draftField"}>
    <span>{label}</span>
    <div className="derivedOptionRow">
      <select value={known ? value : ""} onChange={(event) => event.target.value !== "" && onChange(event.target.value)}>
        {!known && <option value="">valor fora da tabela ({value})</option>}
        {options.map((option) => <option key={option.value} value={option.value}>
          {option.value} · {option.count} skill{option.count === 1 ? "" : "s"} · ex.: {option.sample.slice(0, 28)}
        </option>)}
      </select>
      <input type="number" min={0} max={255} value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} (valor numérico)`} />
    </div>
    <small>{sourceField}{help ? ` · ${help}` : ""}</small>
  </label>;
}
