import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/security";
import { getServerSnapshot, saveSelectedGameConfigs } from "@/lib/server-manager";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const settingsSchema = z.object({
  selectedGameConfigs: z.array(z.string().min(1).max(128)).max(32),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    return NextResponse.json(await getServerSnapshot());
  } catch (error) {
    console.error("Falha ao consultar servidores", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível consultar os servidores." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await authorizeApiRequest(request, true))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Seleção de GameServers inválida." }, { status: 400 });
  }
  try {
    const snapshot = await saveSelectedGameConfigs(parsed.data.selectedGameConfigs);
    const session = await getAdminSession();
    await writeAuditLog({
      administrator: session?.username ?? "unknown",
      action: "servers.selection_updated",
      target: "GameServer configs",
      details: { selectedGameConfigs: snapshot.selectedGameConfigs },
    }).catch((error) => console.error("Falha ao registrar auditoria", error));
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Falha ao salvar seleção de servidores", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível salvar a seleção." },
      { status: 400 },
    );
  }
}
