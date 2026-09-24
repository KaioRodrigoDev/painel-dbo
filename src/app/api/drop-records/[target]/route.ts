import { NextResponse } from "next/server";
import { z } from "zod";

import { loadDropCatalog } from "@/lib/drop-catalog";
import { authorizeApiRequest } from "@/lib/security";

export const runtime = "nodejs";

const querySchema = z.object({
  target: z.enum(["group", "bag"]),
  search: z.string().trim().max(80).default(""),
});

/** Busca de bags/grupos por nome ou TBLIDX, para o editor escolher o que vai numa posição. */
export async function GET(request: Request, { params }: { params: Promise<{ target: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ ...(await params), search: url.searchParams.get("search") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });

  try {
    const catalog = await loadDropCatalog();
    const all = parsed.data.target === "bag"
      ? [...catalog.bagsByTblidx.values()].map((bag) => ({ tblidx: bag.tblidx, name: bag.name || `Bag #${bag.tblidx}`, level: bag.level }))
      : catalog.groups.map((group) => ({ tblidx: group.tblidx, name: group.name || `Grupo #${group.tblidx}`, level: group.level }));

    const search = parsed.data.search.toLocaleLowerCase();
    const records = all
      .filter((record) => !search || record.name.toLocaleLowerCase().includes(search) || String(record.tblidx).includes(search))
      .sort((left, right) => left.tblidx - right.tblidx)
      .slice(0, 40);
    return NextResponse.json({ records, total: all.length });
  } catch (error) {
    console.error("Falha ao buscar registros de drop", error);
    return NextResponse.json({ error: "Não foi possível ler as tabelas de drop." }, { status: 503 });
  }
}
