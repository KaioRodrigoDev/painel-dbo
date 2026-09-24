import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { createDropDraft, listDropDrafts } from "@/lib/drop-drafts";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const slotSchema = z.object({
  tblidx: z.number().int().min(1).max(4294967294),
  probability: z.number().int().min(1).max(100),
});

const draftSchema = z.object({
  target: z.enum(["group", "bag"]),
  tblidx: z.number().int().min(1).max(4294967294),
  values: z.object({
    level: z.number().int().min(0).max(255),
    slots: z.array(slotSchema).max(20),
    enchantAble: z.boolean().optional(),
    tryCount: z.number().int().min(0).max(255).optional(),
    zenny: z.number().int().min(0).max(4294967295).optional(),
    superior: z.number().int().min(0).max(10000).optional(),
    excellent: z.number().int().min(0).max(10000).optional(),
    rare: z.number().int().min(0).max(10000).optional(),
    legendary: z.number().int().min(0).max(10000).optional(),
  }),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ drafts: await listDropDrafts() });
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados do rascunho inválidos." }, { status: 400 });
  try {
    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const draft = await createDropDraft(parsed.data, administrator);
    await writeAuditLog({ administrator, action: "drops.draft_edit", target: `${draft.target}:${draft.tblidx}:${draft.name}` })
      .catch((error) => console.error("Falha ao auditar rascunho de drop", error));
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    console.error("Falha ao criar rascunho de drop", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o rascunho." }, { status: 400 });
  }
}
