import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveGambleRewards } from "@/lib/gamble-catalog";
import { authorizeApiRequest } from "@/lib/security";

export const runtime = "nodejs";

const tblidxSchema = z.coerce.number().int().min(1).max(4294967294);

export async function GET(request: Request, { params }: { params: Promise<{ tblidx: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = tblidxSchema.safeParse((await params).tblidx);
  if (!parsed.success) return NextResponse.json({ error: "Item inválido." }, { status: 400 });

  try {
    const rewards = await resolveGambleRewards(parsed.data);
    // null significa "não é uma caixa": a tela simplesmente não mostra a seção.
    if (!rewards) return NextResponse.json({ gamble: null });
    return NextResponse.json({ gamble: rewards });
  } catch (error) {
    console.error("Falha ao ler os prêmios da aposta", error);
    return NextResponse.json({ error: "Não foi possível ler Table_Use_Item_Data.rdf e table_quest_probability_data.rdf." }, { status: 503 });
  }
}
