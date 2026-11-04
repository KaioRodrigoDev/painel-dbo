import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { ProfessionCatalogError } from "@/lib/profession-catalog";
import {
  applyProfessionCatalog, getProfessionRecipes, ProfessionRecipeError, saveProfessionCatalogRecipe, updateProfessionRecipe,
} from "@/lib/profession-recipes";
import { CATALOG_RECIPE_IDS, PROFESSION_LIMITS } from "@/lib/profession-rules";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

// Faixas largas aqui; as regras do servidor (identidade compilada, pilhas, lotes) ficam em
// lib/profession-rules.ts e rodam de novo dentro da transação.
const valuesSchema = z.object({
  requiredLevel: z.number().int().min(1).max(PROFESSION_LIMITS.maxLevel),
  durationSeconds: z.number().int().min(1).max(PROFESSION_LIMITS.maxSeconds),
  experience: z.number().int().min(0).max(PROFESSION_LIMITS.maxExperience),
  outputCount: z.number().int().min(1).max(PROFESSION_LIMITS.maxByte),
  amounts: z.array(z.number().int().min(1).max(PROFESSION_LIMITS.maxByte)).min(1).max(PROFESSION_LIMITS.maxInputs),
  enabled: z.boolean(),
});

const tblidx = z.number().int().min(1).max(0xfffffffe);
const draftSchema = z.object({
  id: z.number().int().min(CATALOG_RECIPE_IDS.min).max(CATALOG_RECIPE_IDS.max).nullable(),
  specialization: z.number().int().min(0).max(255),
  outputItem: tblidx,
  outputCount: z.number().int().min(1).max(PROFESSION_LIMITS.maxByte),
  inputs: z.array(z.object({ item: tblidx, count: z.number().int().min(1).max(PROFESSION_LIMITS.maxByte) })).min(1).max(PROFESSION_LIMITS.maxInputs),
  requiredLevel: z.number().int().min(1).max(PROFESSION_LIMITS.maxLevel),
  durationSeconds: z.number().int().min(1).max(PROFESSION_LIMITS.maxSeconds),
  experience: z.number().int().min(0).max(PROFESSION_LIMITS.maxExperience),
});
const version = z.string().regex(/^[0-9a-f]{64}$/);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), id: z.number().int().min(1).max(0xffffffff), values: valuesSchema, expected: valuesSchema }),
  z.object({ action: z.literal("catalog"), draft: draftSchema, version }),
  z.object({ action: z.literal("apply"), version }),
]);

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ProfessionRecipeError || error instanceof ProfessionCatalogError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ overview: await getProfessionRecipes() });
  } catch (error) {
    return errorResponse(error, "Não foi possível ler as receitas de profissão.");
  }
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valores da receita inválidos." }, { status: 400 });
  const administrator = (await getAdminSession())?.username ?? "unknown";
  const body = parsed.data;
  try {
    if (body.action === "update") {
      const { previous } = await updateProfessionRecipe(body.id, body.values, body.expected);
      await writeAuditLog({ administrator, action: "professions.recipe_update", target: String(body.id), details: { previous, next: body.values } }).catch(() => undefined);
      return NextResponse.json({ overview: await getProfessionRecipes() });
    }
    if (body.action === "catalog") {
      const saved = await saveProfessionCatalogRecipe(body.draft, body.version);
      await writeAuditLog({ administrator, action: "professions.catalog_save", target: String(saved.id), details: { previous: saved.previous, next: saved.next } }).catch(() => undefined);
      return NextResponse.json({ id: saved.id, overview: await getProfessionRecipes() });
    }
    const applied = await applyProfessionCatalog(body.version);
    await writeAuditLog({ administrator, action: "professions.catalog_apply", target: "profession_forge_recipe", details: applied }).catch(() => undefined);
    return NextResponse.json({ applied, overview: await getProfessionRecipes() });
  } catch (error) {
    return errorResponse(error, "Não foi possível gravar a receita.");
  }
}
