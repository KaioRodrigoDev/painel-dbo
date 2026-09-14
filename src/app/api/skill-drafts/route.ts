import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { createSkillDraft, listSkillDrafts } from "@/lib/skill-drafts";

export const runtime = "nodejs";

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.number()).max(8)]);
const draftSchema = z.object({
  operation: z.enum(["create", "edit"]).default("create"),
  skillClass: z.number().int().min(0).max(2),
  characterClass: z.number().int().min(0).max(20),
  baseTblidx: z.number().int().min(1).max(4294967294),
  newTblidx: z.number().int().min(1).max(4294967294),
  name: z.string().trim().min(1).max(64),
  values: z.record(z.string().max(64), valueSchema).refine((value) => Object.keys(value).length <= 64),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ drafts: await listSkillDrafts() });
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados do rascunho inválidos." }, { status: 400 });
  try {
    const session = await getAdminSession();
    const draft = await createSkillDraft(parsed.data, session?.username ?? "unknown");
    await writeAuditLog({ administrator: session?.username ?? "unknown", action: draft.operation === "edit" ? "skills.draft_edit" : "skills.draft_create", target: `${draft.newTblidx}:${draft.name}` })
      .catch((error) => console.error("Falha ao auditar rascunho de skill", error));
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    console.error("Falha ao criar rascunho de skill", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o rascunho." }, { status: 400 });
  }
}
