import { z } from "zod";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { AdminMailError, requestAdminMail } from "@/lib/admin-mail";

const schema = z.object({
  requestKey: z.string().uuid(),
  itemTblidx: z.number().int().positive(),
  quantity: z.number().int().min(1).max(254),
  message: z.string().trim().min(1).max(120),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!/^\d+$/.test(id) || Number(id) < 1) return Response.json({ error: "Conta inválida." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Item, quantidade ou mensagem inválidos." }, { status: 400 });
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try {
    const result = await requestAdminMail({ ...parsed.data, accountId: Number(id) }, session.username);
    return Response.json({ ...result, message: result.duplicate ? "Este envio já estava registrado." : `Envio de ${result.itemName} para ${result.characterName} registrado. O QueryServer concluirá o correio.` });
  } catch (error) {
    if (error instanceof AdminMailError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Falha ao solicitar envio por correio", error);
    return Response.json({ error: "Não foi possível registrar o envio pelo correio." }, { status: 503 });
  }
}
