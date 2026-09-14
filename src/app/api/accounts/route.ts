import { NextResponse } from "next/server";
import { z } from "zod";

import { listAccounts } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/security";

const querySchema = z.object({
  vipLevel: z.enum(["all", "0", "1", "2", "3"]).default("all"),
  vipState: z.enum(["all", "none", "active", "current", "legacy", "expired", "expiring", "invalid"]).default("all"),
  search: z.string().trim().max(32).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    vipLevel: url.searchParams.get("vipLevel") ?? "all",
    vipState: url.searchParams.get("vipState") ?? "all",
    search: url.searchParams.get("search") ?? "",
    page: url.searchParams.get("page") ?? "1",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await listAccounts({ ...parsed.data, pageSize: 20 }),
    );
  } catch (error) {
    console.error("Falha ao listar contas", error);
    return NextResponse.json(
      { error: "Não foi possível consultar os bancos do Dbo World." },
      { status: 503 },
    );
  }
}
