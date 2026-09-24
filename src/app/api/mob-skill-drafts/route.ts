import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { createMobSkillDraft, listMobSkillDrafts } from "@/lib/mob-skill-publisher";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const draftSchema = z.object({
  mobTblidx: z.number().int().min(1).max(4294967294),
  values: z.object({
    slots: z.array(z.object({
      tblidx: z.number().int().min(1).max(4294967294),
      basis: z.number().int().min(0).max(255),
      lp: z.number().int().min(0).max(65535),
      time: z.number().int().min(0).max(65535),
    })).max(7),
  }),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ drafts: await listMobSkillDrafts() });
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados do rascunho inválidos." }, { status: 400 });
  try {
    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const draft = await createMobSkillDraft(parsed.data.mobTblidx, parsed.data.values, administrator);
    await writeAuditLog({ administrator, action: "mobskills.draft_edit", target: `${draft.mobTblidx}:${draft.mobName}` })
      .catch((error) => console.error("Falha ao auditar rascunho de skill de mob", error));
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    console.error("Falha ao criar rascunho de skill de mob", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o rascunho." }, { status: 400 });
  }
}
