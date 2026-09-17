import { z } from "zod";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { AdminMailError, listVipMailRecipients, previewVipMailGroup, requestMailPackage, requestVipGroupCharacterMail, requestVipGroupMail } from "@/lib/admin-mail";

const levelSchema = z.coerce.number().int().min(1).max(3);
const bodySchema = z.object({
  batchKey: z.string().uuid(), vipLevel: z.number().int().min(1).max(3),
  itemTblidx: z.number().int().positive().optional(), quantity: z.number().int().min(1).max(254).optional(),
  packageId: z.string().uuid().optional(),
  channel: z.enum(["cashshop", "mail"]),
  message: z.string().trim().min(1).max(120).optional(),
  sealItem: z.boolean().optional(),
  recipients: z.array(z.object({ accountId: z.number().int().positive(), charId: z.number().int().positive() })).max(10000).optional(),
}).strict();

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = levelSchema.safeParse(new URL(request.url).searchParams.get("level"));
  if (!parsed.success) return Response.json({ error: "Nível VIP inválido." }, { status: 400 });
  try {
    if (new URL(request.url).searchParams.get("channel") === "mail") return Response.json({ recipients: await listVipMailRecipients(parsed.data) });
    return Response.json(await previewVipMailGroup(parsed.data));
  }
  catch (error) { console.error("Falha ao contar grupo VIP", error); return Response.json({ error: "Não foi possível contar os destinatários." }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nível, item ou quantidade inválidos." }, { status: 400 });
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try {
    if (parsed.data.channel === "mail") {
      if (!parsed.data.message || !parsed.data.recipients) return Response.json({ error: "Informe a mensagem e escolha os personagens." }, { status: 400 });
      if (parsed.data.packageId) {
        if (parsed.data.itemTblidx || parsed.data.quantity) return Response.json({ error: "Escolha um item ou pacote." }, { status: 400 });
        const result = await requestMailPackage({ dispatchKey: parsed.data.batchKey, packageId: parsed.data.packageId,
          message: parsed.data.message, vipLevel: parsed.data.vipLevel, recipients: parsed.data.recipients,
          sealItem: parsed.data.sealItem }, session.username);
        return Response.json({ ...result, message: result.duplicate ? "Este pacote já estava registrado." : `Pacote de ${result.items} itens registrado para ${result.recipients} personagens.` });
      }
      if (!parsed.data.itemTblidx || !parsed.data.quantity) return Response.json({ error: "Selecione um item ou pacote." }, { status: 400 });
      const result = await requestVipGroupCharacterMail({ batchKey: parsed.data.batchKey, vipLevel: parsed.data.vipLevel,
        itemTblidx: parsed.data.itemTblidx, quantity: parsed.data.quantity,
        message: parsed.data.message, recipients: parsed.data.recipients, sealItem: parsed.data.sealItem }, session.username);
      return Response.json({ ...result, message: result.duplicate ? "Este lote já estava registrado." : `Lote de correio registrado para ${result.recipients} personagens.` });
    }
    if (parsed.data.packageId || !parsed.data.itemTblidx || !parsed.data.quantity) return Response.json({ error: "O Cash Shop aceita um item por lote." }, { status: 400 });
    const result = await requestVipGroupMail({ batchKey: parsed.data.batchKey, vipLevel: parsed.data.vipLevel,
      itemTblidx: parsed.data.itemTblidx, quantity: parsed.data.quantity }, session.username);
    return Response.json({ ...result, message: result.duplicate ? "Este lote já estava registrado." : `Lote do Cash Shop registrado para ${result.recipients} contas.` });
  } catch (error) {
    if (error instanceof AdminMailError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Falha ao registrar Cash Shop VIP em grupo", error);
    return Response.json({ error: "Não foi possível registrar o envio em grupo." }, { status: 503 });
  }
}
