import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  loadRecipeCatalog, MAX_RECIPE_MATERIALS, MAX_RECIPE_RESULTS, RECIPE_TYPES, resolveRecipes,
} from "@/lib/recipe-catalog";
import { authorizeApiRequest } from "@/lib/security";
import type { RecipeListResponse } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  type: z.coerce.number().int().min(0).max(255).optional(),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    search: url.searchParams.get("search") ?? "",
    page: url.searchParams.get("page") ?? "1",
    type: url.searchParams.get("type") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });

  try {
    const catalog = await loadRecipeCatalog();
    // A busca também casa o nome do item produzido, que só existe depois de resolver; a tabela
    // tem 664 linhas e o índice de itens é montado uma vez só, então resolver tudo é barato.
    const resolvidas = await resolveRecipes(catalog.tblidxs);
    const search = parsed.data.search.toLocaleLowerCase();
    const filtradas = resolvidas.filter((recipe) =>
      (!search || recipe.name.toLocaleLowerCase().includes(search) || String(recipe.tblidx).includes(search)
        || recipe.results.some((slot) => slot.name.toLocaleLowerCase().includes(search)))
      && (parsed.data.type === undefined || recipe.recipeType === parsed.data.type));

    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(filtradas.length / pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const response: RecipeListResponse = {
      recipes: filtradas.slice((page - 1) * pageSize, page * pageSize),
      page, pageSize, total: filtradas.length, totalPages,
      sourceFile: path.basename(catalog.path),
      sourceUpdatedAt: new Date(catalog.modifiedAt).toISOString(),
      // Com a contagem a tela sabe quais tipos existem de fato: oferecer os 8 do enum no
      // filtro daria seis opções que nunca devolvem nada.
      recipeTypes: RECIPE_TYPES.map((entry) => ({ ...entry, count: resolvidas.filter((recipe) => recipe.recipeType === entry.value).length })),
      maxMaterials: MAX_RECIPE_MATERIALS,
      maxResults: MAX_RECIPE_RESULTS,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Falha ao ler as receitas", error);
    return NextResponse.json({ error: "Não foi possível ler o Table_Item_Recipe_Data.rdf." }, { status: 503 });
  }
}
