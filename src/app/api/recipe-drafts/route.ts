import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { createRecipeDraft, listRecipeDrafts } from "@/lib/recipe-publisher";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const draftSchema = z.object({
  tblidx: z.number().int().min(1).max(4294967294),
  values: z.object({
    valid: z.boolean(),
    recipeType: z.number().int().min(0).max(255),
    needMixLevel: z.number().int().min(0).max(255),
    needMixZenny: z.number().int().min(0).max(4294967295),
    results: z.array(z.object({
      tblidx: z.number().int().min(1).max(4294967294),
      rate: z.number().int().min(1).max(100),
      flag: z.number().int().min(0).max(1),
    })).max(3),
    materials: z.array(z.object({
      tblidx: z.number().int().min(1).max(4294967294),
      quantity: z.number().int().min(1).max(255),
    })).max(5),
  }),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ drafts: await listRecipeDrafts() });
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados do rascunho inválidos." }, { status: 400 });
  try {
    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const draft = await createRecipeDraft(parsed.data.tblidx, parsed.data.values, administrator);
    await writeAuditLog({ administrator, action: draft.operation === "create" ? "recipes.draft_create" : "recipes.draft_edit", target: `${draft.tblidx}:${draft.name}` })
      .catch((error) => console.error("Falha ao auditar rascunho de receita", error));
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    console.error("Falha ao criar rascunho de receita", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o rascunho." }, { status: 400 });
  }
}
