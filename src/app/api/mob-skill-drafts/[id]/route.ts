import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { deleteMobSkillDraft } from "@/lib/mob-skill-publisher";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const draft = await deleteMobSkillDraft(id);
    await writeAuditLog({ administrator, action: "mobskills.draft_discard", target: `${draft.mobTblidx}:${draft.mobName}` })
      .catch((error) => console.error("Falha ao auditar descarte", error));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível descartar o rascunho." }, { status: 400 });
  }
}
