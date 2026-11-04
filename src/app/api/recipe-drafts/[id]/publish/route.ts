import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { getRecipePublishPreview, publishRecipeDraft } from "@/lib/recipe-publisher";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const confirmationSchema = z.object({ confirmationToken: z.string().regex(/^[a-f0-9]{64}$/i) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    return NextResponse.json({ preview: await getRecipePublishPreview(id) });
  } catch (error) {
    console.error("Falha ao validar publicação de receita", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível validar a publicação." }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = confirmationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confirmação de publicação inválida." }, { status: 400 });
  try {
    const { id } = await context.params;
    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const result = await publishRecipeDraft(id, parsed.data.confirmationToken, administrator);
    await writeAuditLog({
      administrator, action: "recipes.rdf_publish", target: `${result.draft.tblidx}:${result.draft.name}`,
      details: { draftId: id, operation: result.operation, backupPath: result.backupPath, beforeHash: result.beforeHash, afterHash: result.afterHash },
    }).catch((error) => console.error("Falha ao auditar publicação de receita", error));
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Falha ao publicar receita no RDF", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível publicar a receita." }, { status: 400 });
  }
}
