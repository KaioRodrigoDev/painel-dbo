import { NextResponse } from "next/server";

import { crashDetail } from "@/lib/crash-reports";
import { authorizeApiRequest } from "@/lib/security";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) return NextResponse.json({ error: "Relatório inválido." }, { status: 400 });
  try {
    const crash = await crashDetail(Number(id));
    if (!crash) return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
    return NextResponse.json(crash, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao abrir relatório de crash", error);
    return NextResponse.json({ error: "Não foi possível abrir o relatório." }, { status: 503 });
  }
}
