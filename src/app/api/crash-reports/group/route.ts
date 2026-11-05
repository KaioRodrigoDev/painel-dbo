import { NextResponse } from "next/server";
import { z } from "zod";

import { CRASH_STATUSES, crashesOf, setGroupStatus } from "@/lib/crash-reports";
import { authorizeApiRequest } from "@/lib/security";

const signature = z.string().regex(/^[0-9a-f]{16}$/);

/** Relatórios de um grupo (?signature=...). */
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = signature.safeParse(new URL(request.url).searchParams.get("signature"));
  if (!parsed.success) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
  try {
    return NextResponse.json({ crashes: await crashesOf(parsed.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao listar relatórios do grupo", error);
    return NextResponse.json({ error: "Não foi possível consultar o grupo." }, { status: 503 });
  }
}

const patchSchema = z.object({ signature, status: z.enum(CRASH_STATUSES as [string, ...string[]]) }).strict();

/** Marca o grupo inteiro: visto, corrigido, ignorado ou novo de novo. */
export async function PATCH(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Grupo ou estado inválido." }, { status: 400 });
  try {
    const updated = await setGroupStatus(parsed.data.signature, parsed.data.status as (typeof CRASH_STATUSES)[number]);
    return NextResponse.json({ updated });
  } catch (error) {
    console.error("Falha ao marcar grupo de crash", error);
    return NextResponse.json({ error: "Não foi possível salvar o estado." }, { status: 503 });
  }
}
