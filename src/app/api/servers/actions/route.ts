import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/security";
import { runServerAction } from "@/lib/server-manager";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["start", "stop", "restart"]), serviceId: z.string().min(1).max(160) }),
  z.object({ action: z.enum(["start-all", "stop-all"]) }),
]);

const auditActions = {
  start: "servers.start",
  stop: "servers.stop",
  restart: "servers.restart",
  "start-all": "servers.start_all",
  "stop-all": "servers.stop_all",
} as const;

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ação de servidor inválida." }, { status: 400 });
  }
  try {
    const serviceId = "serviceId" in parsed.data ? parsed.data.serviceId : undefined;
    const snapshot = await runServerAction(parsed.data.action, serviceId);
    const session = await getAdminSession();
    await writeAuditLog({
      administrator: session?.username ?? "unknown",
      action: auditActions[parsed.data.action],
      target: serviceId ?? "all",
    }).catch((error) => console.error("Falha ao registrar auditoria", error));
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Falha ao controlar servidor", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível executar a ação." },
      { status: 503 },
    );
  }
}
