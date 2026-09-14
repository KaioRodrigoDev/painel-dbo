import { authorizeApiRequest } from "@/lib/security";
import { getAccountPool, getCharacterPool } from "@/lib/db";
import { vipOverview } from "@/lib/vip-store";

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return Response.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return Response.json(await vipOverview(getAccountPool(), getCharacterPool()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha na visão geral", error);
    return Response.json({ error: "Não foi possível carregar a visão geral. Verifique a conexão e execute a migração VIP." }, { status: 503 });
  }
}
