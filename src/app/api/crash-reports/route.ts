import { NextResponse } from "next/server";
import { z } from "zod";

import { crashOverview } from "@/lib/crash-reports";
import { authorizeApiRequest } from "@/lib/security";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
  status: z.enum(["open", "all", "new", "seen", "fixed", "ignored"]).default("open"),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  try {
    return NextResponse.json(await crashOverview(parsed.data.days, parsed.data.status), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao listar erros do jogo", error);
    return NextResponse.json({ error: "Não foi possível consultar os erros do jogo." }, { status: 503 });
  }
}
