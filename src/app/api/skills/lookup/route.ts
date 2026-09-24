import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeApiRequest } from "@/lib/security";
import { loadSkillCatalog } from "@/lib/skill-catalog";

export const runtime = "nodejs";

const querySchema = z.object({ ids: z.string().max(400) });

/**
 * Resolve vários TBLIDX de skill de uma vez.
 *
 * O editor precisa disto para mostrar o nome do que já está gravado nos campos de referência
 * (raiz, próxima grade, pré-requisitos). A busca por nome não serve aqui: o valor gravado
 * pode apontar para fora da família carregada na tela.
 */
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = querySchema.safeParse({ ids: new URL(request.url).searchParams.get("ids") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });

  try {
    const catalog = await loadSkillCatalog();
    const wanted = [...new Set(parsed.data.ids.split(",").map((part) => Number(part.trim())).filter(Number.isFinite))].slice(0, 40);
    const skills = wanted
      .map((id) => catalog.skills.find((skill) => skill.tblidx === id))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
      .map((skill) => ({ tblidx: skill.tblidx, name: skill.name, iconName: skill.iconName, grade: skill.grade, requiredLevel: skill.requiredLevel }));
    return NextResponse.json({ skills });
  } catch (error) {
    console.error("Falha ao resolver skills", error);
    return NextResponse.json({ error: "Não foi possível ler o catálogo de skills." }, { status: 503 });
  }
}
