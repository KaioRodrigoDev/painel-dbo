import { NextResponse } from "next/server";
import { z } from "zod";

import { battlePassErrorResponse, seasonValuesSchema } from "@/app/api/battle-pass/schemas";
import { writeAuditLog } from "@/lib/audit";
import { cloneSeason, createSeason, getBattlePassOverview } from "@/lib/battle-pass";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), values: seasonValuesSchema }),
  z.object({ action: z.literal("clone"), sourceSeasonId: z.number().int().min(1), seasonId: z.number().int().min(1).max(0xffffffff), name: z.string().max(200), startTime: z.number().int().min(0) }),
]);

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ overview: await getBattlePassOverview() });
  } catch (error) {
    return battlePassErrorResponse(error, "Não foi possível ler o Battle Pass.");
  }
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados da temporada inválidos." }, { status: 400 });
  const administrator = (await getAdminSession())?.username ?? "unknown";
  try {
    if (parsed.data.action === "create") {
      await createSeason(parsed.data.values);
      await writeAuditLog({ administrator, action: "battlepass.season_create", target: String(parsed.data.values.seasonId), details: { values: parsed.data.values } }).catch(() => undefined);
      return NextResponse.json({ seasonId: parsed.data.values.seasonId });
    }
    const { sourceSeasonId, seasonId, name, startTime } = parsed.data;
    await cloneSeason(sourceSeasonId, { seasonId, name, startTime });
    await writeAuditLog({ administrator, action: "battlepass.season_clone", target: String(seasonId), details: { sourceSeasonId, name, startTime } }).catch(() => undefined);
    return NextResponse.json({ seasonId });
  } catch (error) {
    return battlePassErrorResponse(error, "Não foi possível criar a temporada.");
  }
}
