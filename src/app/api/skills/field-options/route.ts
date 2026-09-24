import { NextResponse } from "next/server";

import { authorizeApiRequest } from "@/lib/security";
import { loadSkillCatalog } from "@/lib/skill-catalog";
import type { SkillCatalogEntry, SkillFieldOption, SkillFieldOptions } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Campos numéricos sem enumeração conhecida no código do servidor.
 *
 * `byClass_Type` e `byUse_Type` não têm enum em lugar nenhum da base -- o servidor nem lê o
 * segundo. Em vez de deixar uma caixa de número pedindo um valor inventado, a opção sai dos
 * valores que a própria tabela usa, com quantas skills usam cada um e um exemplo. Assim dá
 * para escolher olhando a realidade do jogo em vez de adivinhar.
 */
const DERIVED_FIELDS = ["classType", "useType", "grade", "skillGroup", "buffGroup", "slotIndex"] as const;

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const catalog = await loadSkillCatalog();
    const options: SkillFieldOptions = {};
    for (const field of DERIVED_FIELDS) {
      const tally = new Map<number, { count: number; sample: string }>();
      for (const skill of catalog.skills) {
        const value = skill[field as keyof SkillCatalogEntry];
        if (typeof value !== "number") continue;
        const current = tally.get(value);
        if (current) current.count += 1;
        else tally.set(value, { count: 1, sample: skill.name });
      }
      options[field] = [...tally.entries()]
        .map(([value, info]): SkillFieldOption => ({ value, count: info.count, sample: info.sample }))
        .sort((left, right) => left.value - right.value);
    }
    return NextResponse.json({ options, total: catalog.skills.length });
  } catch (error) {
    console.error("Falha ao montar as opções de campo", error);
    return NextResponse.json({ error: "Não foi possível ler o catálogo de skills." }, { status: 503 });
  }
}
