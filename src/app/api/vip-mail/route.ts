import { z } from "zod";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { AdminMailError, previewVipMailGroup, requestVipGroupMail } from "@/lib/admin-mail";

const levelSchema = z.coerce.number().int().min(1).max(3);
const bodySchema = z.object({
  batchKey: z.string().uuid(), vipLevel: z.number().int().min(1).max(3),
  itemTblidx: z.number().int().positive(), quantity: z.number().int().min(1).max(254),
  message: z.string().trim().min(1).max(120),
}).strict();

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = levelSchema.safeParse(new URL(request.url).searchParams.get("level"));
  if (!parsed.success) return Response.json({ error: "Nível VIP inválido." }, { status: 400 });
  try { return Response.json(await previewVipMailGroup(parsed.data)); }
  catch (error) { console.error("Falha ao contar grupo VIP", error); return Response.json({ error: "Não foi possível contar os destinatários." }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nível, item, quantidade ou mensagem inválidos." }, { status: 400 });
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try {
    const result = await requestVipGroupMail(parsed.data, session.username);
    return Response.json({ ...result, message: result.duplicate ? "Este lote já estava registrado." : `Lote registrado para ${result.recipients} contas${result.skipped ? `; ${result.skipped} caixas cheias foram ignoradas` : ""}.` });
  } catch (error) {
    if (error instanceof AdminMailError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Falha ao registrar correio VIP em grupo", error);
    return Response.json({ error: "Não foi possível registrar o envio em grupo." }, { status: 503 });
  }
}
