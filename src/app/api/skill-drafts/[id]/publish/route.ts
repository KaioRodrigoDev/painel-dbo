import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { getSkillPublishPreview, publishSkillDraft } from "@/lib/skill-rdf-publisher";

export const runtime = "nodejs";

const confirmationSchema = z.object({
  confirmationToken: z.string().regex(/^[a-f0-9]{64}$/i),
  // Etapas do cliente escolhidas na hora de publicar; ambas opcionais e independentes.
  replaceClientPack: z.boolean().default(false),
  clientPackDirectory: z.string().max(4096).nullish(),
  prepareDownload: z.boolean().default(false),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    return NextResponse.json({ preview: await getSkillPublishPreview(id) });
  } catch (error) {
    console.error("Falha ao validar publicação de skill", error);
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
    const result = await publishSkillDraft(id, parsed.data.confirmationToken, administrator, {
      replaceClientPack: parsed.data.replaceClientPack,
      clientPackDirectory: parsed.data.clientPackDirectory,
      prepareDownload: parsed.data.prepareDownload,
    });
    await writeAuditLog({
      administrator,
      action: "skills.rdf_publish",
      target: `${result.draft.newTblidx}:${result.draft.name}`,
      details: {
        draftId: id,
        backupPath: result.backupPath,
        changedFields: result.changes.map((change) => change.id),
        beforeHash: result.beforeHash,
        afterHash: result.afterHash,
        clientPackReplaced: result.clientPack.replaced?.packPath ?? null,
        clientPackBackup: result.clientPack.replaced?.backupPath ?? null,
        clientPackDownload: result.clientPack.download?.fileName ?? null,
      },
    }).catch((error) => console.error("Falha ao auditar publicação RDF de skill", error));
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Falha ao publicar skill no RDF", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível publicar a skill." }, { status: 400 });
  }
}
