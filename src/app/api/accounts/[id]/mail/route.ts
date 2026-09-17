import { z } from "zod";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { AdminMailError, requestAdminMail, requestCharacterMail, requestMailPackage } from "@/lib/admin-mail";

const schema = z.object({
  requestKey: z.string().uuid(),
  itemTblidx: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(254).optional(),
  packageId: z.string().uuid().optional(),
  channel: z.enum(["cashshop", "mail"]),
  charId: z.number().int().positive().optional(),
  message: z.string().trim().min(1).max(120).optional(),
  sealItem: z.boolean().optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!/^\d+$/.test(id) || Number(id) < 1) return Response.json({ error: "Conta inválida." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Item ou quantidade inválidos." }, { status: 400 });
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try {
    if (parsed.data.channel === "mail") {
      if (!parsed.data.charId || !parsed.data.message) return Response.json({ error: "Selecione o personagem e informe a mensagem." }, { status: 400 });
      if (parsed.data.packageId) {
        if (parsed.data.itemTblidx || parsed.data.quantity) return Response.json({ error: "Escolha um item ou um pacote." }, { status: 400 });
        const result = await requestMailPackage({ dispatchKey: parsed.data.requestKey, packageId: parsed.data.packageId,
          accountId: Number(id), charId: parsed.data.charId, message: parsed.data.message,
          sealItem: parsed.data.sealItem }, session.username);
        return Response.json({ ...result, message: result.duplicate ? "Este pacote já estava registrado." : `Pacote com ${result.items} itens registrado para o correio do personagem.` });
      }
      if (!parsed.data.itemTblidx || !parsed.data.quantity) return Response.json({ error: "Selecione um item ou pacote." }, { status: 400 });
      const result = await requestCharacterMail({ requestKey: parsed.data.requestKey, channel: "mail",
        itemTblidx: parsed.data.itemTblidx, quantity: parsed.data.quantity, charId: parsed.data.charId,
        message: parsed.data.message, accountId: Number(id), sealItem: parsed.data.sealItem }, session.username);
      return Response.json({ ...result, message: result.duplicate ? "Este envio já estava registrado." : `${result.itemName} foi registrado para o correio de ${result.characterName}.` });
    }
    if (parsed.data.packageId || !parsed.data.itemTblidx || !parsed.data.quantity) return Response.json({ error: "O Cash Shop aceita um item por envio." }, { status: 400 });
    const result = await requestAdminMail({ requestKey: parsed.data.requestKey, channel: "cashshop",
      itemTblidx: parsed.data.itemTblidx, quantity: parsed.data.quantity, accountId: Number(id) }, session.username);
    return Response.json({ ...result, message: result.duplicate ? "Este envio já estava registrado." : `${result.itemName} foi registrado para o Cash Shop da conta ${result.accountName}.` });
  } catch (error) {
    if (error instanceof AdminMailError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Falha ao solicitar envio pelo Cash Shop", error);
    return Response.json({ error: "Não foi possível registrar o envio pelo Cash Shop." }, { status: 503 });
  }
}
