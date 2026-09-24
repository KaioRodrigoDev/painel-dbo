import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveMobDrops } from "@/lib/drop-catalog";
import { authorizeApiRequest } from "@/lib/security";
import type { MobDropsResponse } from "@/lib/types";

export const runtime = "nodejs";

const tblidxSchema = z.coerce.number().int().min(1).max(4294967294);

export async function GET(request: Request, { params }: { params: Promise<{ tblidx: string }> }) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const parsed = tblidxSchema.safeParse((await params).tblidx);
  if (!parsed.success) return NextResponse.json({ error: "Mob inválido." }, { status: 400 });

  try {
    const drops = await resolveMobDrops(parsed.data);
    if (!drops) return NextResponse.json({ error: "Mob não encontrado no catálogo." }, { status: 404 });
    return NextResponse.json(drops satisfies MobDropsResponse);
  } catch (error) {
    console.error("Falha ao ler as tabelas de drop", error);
    return NextResponse.json(
      { error: "Não foi possível ler table_item_group_list_data.rdf e table_item_bag_list_data.rdf." },
      { status: 503 },
    );
  }
}
