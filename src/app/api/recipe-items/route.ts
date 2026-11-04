import { NextResponse } from "next/server";
import { z } from "zod";

import { listRecipeItemCandidates } from "@/lib/recipe-catalog";
import { authorizeApiRequest } from "@/lib/security";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""),
  onlyFree: z.enum(["0", "1"]).default("1"),
});

/** Itens do tipo Receita, para escolher qual receita criar ou editar. */
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ search: url.searchParams.get("search") ?? "", onlyFree: url.searchParams.get("onlyFree") ?? "1" });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  try {
    return NextResponse.json({ items: await listRecipeItemCandidates(parsed.data.search, parsed.data.onlyFree === "1") });
  } catch (error) {
    console.error("Falha ao listar itens-receita", error);
    return NextResponse.json({ error: "Não foi possível ler as tabelas de item e receita." }, { status: 503 });
  }
}
