import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { applySkillBatch, discardSkillBatch, exportSkillBatch, getSkillBatchPreview } from "@/lib/skill-batch";

export const runtime = "nodejs";

const token = z.string().regex(/^[a-f0-9]{64}$/i);
const packDirectory = z.string().max(4096).nullish();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), token, server: z.boolean(), client: z.boolean(), clientPackDirectory: packDirectory }),
  z.object({ action: z.literal("export"), token, clientPackDirectory: packDirectory }),
  z.object({ action: z.literal("discard"), tblidxs: z.union([z.literal("all"), z.array(z.number().int().min(1).max(4294967294)).min(1).max(5000)]) }),
]);

/** Skills com edição pendente, já comparadas com o RDF atual. */
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ batch: await getSkillBatchPreview() });
  } catch (error) {
    console.error("Falha ao montar o lote de skills", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível montar o lote." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido para o lote." }, { status: 400 });

  const session = await getAdminSession();
  const administrator = session?.username ?? "unknown";
  const audit = (action: "skills.batch_apply" | "skills.batch_export" | "skills.draft_discard", target: string, details: Record<string, unknown>) =>
    writeAuditLog({ administrator, action, target, details }).catch((error) => console.error("Falha ao auditar lote de skills", error));

  try {
    if (parsed.data.action === "apply") {
      const result = await applySkillBatch(parsed.data.token, parsed.data, administrator);
      await audit("skills.batch_apply", `${result.applied.length} skills`, {
        skills: result.applied.map((entry) => entry.tblidx), server: result.server, client: result.client, skipped: result.skipped.map((entry) => entry.tblidx),
      });
      return NextResponse.json({ result });
    }
    if (parsed.data.action === "export") {
      const result = await exportSkillBatch(parsed.data.token, parsed.data, administrator);
      await audit("skills.batch_export", result.exportId, { skills: result.skills, changes: result.changes, packFileName: result.packFileName });
      return NextResponse.json({ result });
    }
    const result = await discardSkillBatch(parsed.data.tblidxs);
    await audit("skills.draft_discard", parsed.data.tblidxs === "all" ? "todas" : parsed.data.tblidxs.join(","), result);
    return NextResponse.json({ result });
  } catch (error) {
    console.error(`Falha na ação ${parsed.data.action} do lote de skills`, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível concluir a ação do lote." }, { status: 400 });
  }
}
