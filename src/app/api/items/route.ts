import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { loadCashShopItemMappings, loadItemCatalog } from "@/lib/item-catalog";
import { describeItemEffects } from "@/lib/item-effects";
import { authorizeApiRequest } from "@/lib/security";
import type { ItemCatalogResponse } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  itemType: z.coerce.number().int().min(0).max(255).optional(),
  rank: z.coerce.number().int().min(0).max(255).optional(),
  cashShop: z.enum(["0", "1"]).default("0"),
  // Faixa do nível mínimo exigido para usar o item (Need_Min_Level), as duas pontas inclusas.
  minLevel: z.coerce.number().int().min(0).max(255).optional(),
  maxLevel: z.coerce.number().int().min(0).max(255).optional(),
  // Só o catálogo pede: os efeitos do tooltip leem mais três tabelas, os seletores não precisam.
  details: z.enum(["0", "1"]).default("0"),
  // 30 é o padrão dos seletores de item das outras telas; 40/80/120 são as opções do catálogo.
  pageSize: z.enum(["30", "40", "80", "120"]).default("30"),
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
    cashShop: url.searchParams.get("cashShop") ?? "0",
    minLevel: url.searchParams.get("minLevel") || undefined,
    maxLevel: url.searchParams.get("maxLevel") || undefined,
    details: url.searchParams.get("details") ?? "0",
    pageSize: url.searchParams.get("pageSize") ?? "30",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  }
  // "de 20 a 10" vira "de 10 a 20": a faixa digitada ao contrário ainda quer dizer a mesma coisa.
  const { minLevel, maxLevel } = parsed.data;
  const levelFrom = minLevel !== undefined && maxLevel !== undefined ? Math.min(minLevel, maxLevel) : minLevel;
  const levelTo = minLevel !== undefined && maxLevel !== undefined ? Math.max(minLevel, maxLevel) : maxLevel;

  try {
    const catalog = await loadItemCatalog();
    const cashShopMappings = parsed.data.cashShop === "1" ? await loadCashShopItemMappings() : null;
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
        (!cashShopMappings || cashShopMappings.has(item.tblidx)) &&
        (parsed.data.itemType === undefined || item.itemType === parsed.data.itemType) &&
        (parsed.data.rank === undefined || item.rank === parsed.data.rank) &&
        (levelFrom === undefined || item.minimumLevel >= levelFrom) &&
        (levelTo === undefined || item.minimumLevel <= levelTo)
      );
    });

    const pageSize = Number(parsed.data.pageSize);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
    // Sem as tabelas de efeito o catálogo continua funcionando; o tooltip só avisa que faltam.
    let effectsError: string | undefined;
    const effects = parsed.data.details === "1"
      ? await describeItemEffects(pageItems).catch((error: unknown) => {
        console.error("Falha ao ler os efeitos dos itens", error);
        effectsError = error instanceof Error ? error.message : "Falha ao ler as tabelas de efeito.";
        return null;
      })
      : null;
    const response: ItemCatalogResponse = {
      items: pageItems.map((item) => {
        const mapping = cashShopMappings?.get(item.tblidx);
        const withEffects = effects ? { ...item, effects: effects.get(item.tblidx) } : item;
        return mapping ? { ...withEffects, cashShopTblidx: mapping.tblidx, cashShopStack: mapping.stack } : withEffects;
      }),
      page,
      pageSize,
      total: filtered.length,
      totalPages,
      sourceFile: path.basename(catalog.path),
      textSourceFile: path.basename(catalog.textPath),
      sourceUpdatedAt: new Date(catalog.modifiedAt).toISOString(),
      availableTypes: [...new Set(catalog.items.map((item) => item.itemType))].sort((a, b) => a - b),
      availableRanks: [...new Set(catalog.items.map((item) => item.rank))].sort((a, b) => a - b),
      ...(effectsError ? { effectsError } : {}),
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
