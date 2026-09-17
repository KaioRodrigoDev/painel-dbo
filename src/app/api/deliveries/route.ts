import { NextResponse } from "next/server";
import { z } from "zod";

import { listDeliveries } from "@/lib/deliveries";
import { authorizeApiRequest } from "@/lib/security";

const querySchema = z.object({
  channel: z.enum(["all", "mail", "cashshop"]).default("all"),
  status: z.enum(["all", "pending", "processing", "applied", "claimed", "failed"]).default("all"),
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  try {
    return NextResponse.json(await listDeliveries({ ...parsed.data, pageSize: 30 }));
  } catch (error) {
    console.error("Falha ao listar envios", error);
    return NextResponse.json({ error: "Não foi possível consultar os envios." }, { status: 503 });
  }
}
