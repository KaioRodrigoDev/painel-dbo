import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import { loadMobCatalog } from "@/lib/mob-catalog";
import { MAX_MOB_SKILLS, resolveMobSkills, SKILL_BASIS } from "@/lib/mob-skill-catalog";
import { authorizeApiRequest } from "@/lib/security";
import type { MobSkillsResponse } from "@/lib/types";

export const runtime = "nodejs";

const tblidxSchema = z.coerce.number().int().min(1).max(4294967294);

export async function GET(request: Request, { params }: { params: Promise<{ tblidx: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = tblidxSchema.safeParse((await params).tblidx);
  if (!parsed.success) return NextResponse.json({ error: "Mob inválido." }, { status: 400 });

  try {
    const resolved = await resolveMobSkills(parsed.data);
    if (!resolved) return NextResponse.json({ error: "Mob não encontrado no catálogo." }, { status: 404 });
    const catalog = await loadMobCatalog();
    const response: MobSkillsResponse = {
      mob: resolved.mob,
      slots: resolved.slots,
      maxSlots: MAX_MOB_SKILLS,
      basisOptions: SKILL_BASIS.map((entry) => ({ value: entry.value, label: entry.label, note: entry.note, lpMeaning: entry.lpMeaning })),
      sourceFile: path.basename(catalog.path),
      sourceUpdatedAt: new Date(catalog.modifiedAt).toISOString(),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Falha ao ler as skills do mob", error);
    return NextResponse.json({ error: "Não foi possível ler o Table_MOB_Data.rdf configurado." }, { status: 503 });
  }
}
