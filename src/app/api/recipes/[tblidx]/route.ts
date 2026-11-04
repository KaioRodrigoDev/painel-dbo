import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRecipe } from "@/lib/recipe-catalog";
import { authorizeApiRequest } from "@/lib/security";

export const runtime = "nodejs";

const schema = z.coerce.number().int().min(1).max(4294967294);

export async function GET(request: Request, { params }: { params: Promise<{ tblidx: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse((await params).tblidx);
  if (!parsed.success) return NextResponse.json({ error: "Receita inválida." }, { status: 400 });
  try {
    const recipe = await resolveRecipe(parsed.data);
    return NextResponse.json({ recipe });
  } catch (error) {
    console.error("Falha ao ler a receita", error);
    return NextResponse.json({ error: "Não foi possível ler o Table_Item_Recipe_Data.rdf." }, { status: 503 });
  }
}
