import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { createItemDraft, listItemDrafts } from "@/lib/item-drafts";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.number()).max(16)]);
const draftSchema = z.object({
  itemType: z.number().int().min(0).max(255),
  baseTblidx: z.number().int().min(1).max(4294967294),
  newTblidx: z.number().int().min(1).max(4294967294),
  name: z.string().trim().min(1).max(64),
  values: z.record(z.string().max(64), valueSchema).refine((value) => Object.keys(value).length <= 80),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return NextResponse.json({ drafts: await listItemDrafts() });
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados do rascunho inválidos." }, { status: 400 });
  }

  try {
    const session = await getAdminSession();
    const draft = await createItemDraft(parsed.data, session?.username ?? "unknown");
    await writeAuditLog({ administrator: session?.username ?? "unknown", action: "items.draft_create", target: `${draft.newTblidx}:${draft.name}` })
      .catch((error) => console.error("Falha ao auditar rascunho de item", error));
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    console.error("Falha ao criar rascunho de item", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o rascunho." }, { status: 400 });
  }
}
