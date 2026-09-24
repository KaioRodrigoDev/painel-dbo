import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { deleteDropDraft } from "@/lib/drop-drafts";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const draft = await deleteDropDraft(id);
    await writeAuditLog({ administrator, action: "drops.draft_discard", target: `${draft.target}:${draft.tblidx}:${draft.name}` })
      .catch((error) => console.error("Falha ao auditar descarte de rascunho", error));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível descartar o rascunho." }, { status: 400 });
  }
}
