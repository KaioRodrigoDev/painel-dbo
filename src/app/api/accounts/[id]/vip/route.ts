import { z } from "zod";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { getAccountPool } from "@/lib/db";
import { changeVip, VipError } from "@/lib/vip-store";

const schema = z.object({
  requestId: z.string().uuid(), operation: z.enum(["edit", "renew"]),
  level: z.number().int().min(0).max(3), duration: z.enum(["15", "30", "60", "date", "keep"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) return Response.json({ error: "Conta inválida." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nível, prazo ou operação inválidos." }, { status: 400 });
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try {
    const result = await changeVip(getAccountPool(), Number(id), parsed.data, session.username);
    const message = result.vipExpirySupported
      ? "VIP salvo no banco. Sessões do jogo já abertas podem manter o nível anterior até a recarga da conta."
      : "Nível VIP salvo. A validade ficará indisponível até a coluna vip_expires_at ser criada neste servidor.";
    return Response.json({ ...result, message });
  } catch (error) {
    if (error instanceof VipError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Falha ao atualizar VIP", error);
    return Response.json({ error: "Não foi possível salvar o VIP. Verifique o banco e a migração VIP." }, { status: 503 });
  }
}
