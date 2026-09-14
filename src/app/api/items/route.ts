import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { loadItemCatalog } from "@/lib/item-catalog";
import { authorizeApiRequest } from "@/lib/security";
import type { ItemCatalogResponse } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  itemType: z.coerce.number().int().min(0).max(255).optional(),
  rank: z.coerce.number().int().min(0).max(255).optional(),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    search: url.searchParams.get("search") ?? "",
    page: url.searchParams.get("page") ?? "1",
    itemType: url.searchParams.get("itemType") ?? undefined,
    rank: url.searchParams.get("rank") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  }

  try {
    const catalog = await loadItemCatalog();
    const search = parsed.data.search.toLocaleLowerCase();
    const filtered = catalog.items.filter((item) => {
      const matchesSearch =
        !search ||
        item.name.toLocaleLowerCase().includes(search) ||
        item.internalName.toLocaleLowerCase().includes(search) ||
        item.iconName.toLocaleLowerCase().includes(search) ||
        item.modelName.toLocaleLowerCase().includes(search) ||
        String(item.tblidx).includes(search);
      return (
        matchesSearch &&
        (parsed.data.itemType === undefined || item.itemType === parsed.data.itemType) &&
        (parsed.data.rank === undefined || item.rank === parsed.data.rank)
      );
    });

    const pageSize = 30;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const response: ItemCatalogResponse = {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: filtered.length,
      totalPages,
      sourceFile: path.basename(catalog.path),
      textSourceFile: path.basename(catalog.textPath),
      sourceUpdatedAt: new Date(catalog.modifiedAt).toISOString(),
      availableTypes: [...new Set(catalog.items.map((item) => item.itemType))].sort((a, b) => a - b),
      availableRanks: [...new Set(catalog.items.map((item) => item.rank))].sort((a, b) => a - b),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Falha ao ler o catálogo de itens", error);
    return NextResponse.json(
      { error: "Não foi possível ler o Table_Item_Data.rdf configurado." },
      { status: 503 },
    );
  }
}
