import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import { loadMobCatalog } from "@/lib/mob-catalog";
import { authorizeApiRequest } from "@/lib/security";
import type { MobCatalogResponse } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""), page: z.coerce.number().int().min(1).max(100000).default(1),
  grade: z.coerce.number().int().min(0).max(255).optional(), type: z.coerce.number().int().min(0).max(255).optional(),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ search: url.searchParams.get("search") ?? "", page: url.searchParams.get("page") ?? "1", grade: url.searchParams.get("grade") ?? undefined, type: url.searchParams.get("type") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  try {
    const catalog = await loadMobCatalog();
    const search = parsed.data.search.toLocaleLowerCase();
    const filtered = catalog.mobs.filter((mob) => (!search || mob.name.toLocaleLowerCase().includes(search) || mob.internalName.toLocaleLowerCase().includes(search) || mob.modelName.toLocaleLowerCase().includes(search) || String(mob.tblidx).includes(search)) && (parsed.data.grade === undefined || mob.grade === parsed.data.grade) && (parsed.data.type === undefined || mob.mobType === parsed.data.type));
    const pageSize = 30;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const response: MobCatalogResponse = { mobs: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length, totalPages, sourceFile: path.basename(catalog.path), textSourceFile: path.basename(catalog.textPath), sourceUpdatedAt: new Date(catalog.modifiedAt).toISOString(), availableGrades: [...new Set(catalog.mobs.map((mob) => mob.grade))].sort((a, b) => a - b), availableTypes: [...new Set(catalog.mobs.map((mob) => mob.mobType))].sort((a, b) => a - b) };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Falha ao ler o catálogo de mobs", error);
    return NextResponse.json({ error: "Não foi possível ler o Table_MOB_Data.rdf configurado." }, { status: 503 });
  }
}
