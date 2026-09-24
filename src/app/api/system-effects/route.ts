import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeApiRequest } from "@/lib/security";
import { loadSystemEffectCatalog } from "@/lib/system-effect-catalog";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""),
  ids: z.string().max(200).optional(),
});

/** Busca de efeitos do sistema por nome ou TBLIDX, e resolução em lote por `ids`. */
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ search: url.searchParams.get("search") ?? "", ids: url.searchParams.get("ids") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });

  try {
    const catalog = await loadSystemEffectCatalog();
    if (parsed.data.ids !== undefined) {
      const wanted = parsed.data.ids.split(",").map((part) => Number(part.trim())).filter(Number.isFinite);
      return NextResponse.json({ effects: wanted.map((id) => catalog.byTblidx.get(id)).filter(Boolean) });
    }
    const search = parsed.data.search.toLocaleLowerCase();
    const effects = catalog.effects
      .filter((effect) => !search || effect.name.toLocaleLowerCase().includes(search) || String(effect.tblidx).includes(search))
      .slice(0, 40);
    return NextResponse.json({ effects, total: catalog.effects.length });
  } catch (error) {
    console.error("Falha ao ler os efeitos do sistema", error);
    return NextResponse.json({ error: "Não foi possível ler o Table_System_Effect_Data.rdf." }, { status: 503 });
  }
}
