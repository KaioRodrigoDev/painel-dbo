import { NextResponse } from "next/server";
import { z } from "zod";

import { battlePassErrorResponse, missionValuesSchema, rewardValuesSchema, seasonValuesSchema } from "@/app/api/battle-pass/schemas";
import { writeAuditLog } from "@/lib/audit";
import {
  activateSeason, deactivateSeason, deleteMission, deleteReward, deleteSeason, getBattlePassSeason,
  saveMission, saveReward, suggestMissionId, updateSeason,
} from "@/lib/battle-pass";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";

const slot = z.object({ level: z.number().int().min(1).max(128), track: z.union([z.literal(0), z.literal(1)]) });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), values: seasonValuesSchema }),
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("deactivate") }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("saveMission"), mode: z.enum(["create", "update"]), mission: missionValuesSchema }),
  z.object({ action: z.literal("deleteMission"), missionId: z.number().int().min(1) }),
  z.object({ action: z.literal("saveReward"), reward: rewardValuesSchema, original: slot.nullable() }),
  z.object({ action: z.literal("deleteReward"), level: slot.shape.level, track: slot.shape.track }),
]);

async function seasonIdFrom(context: { params: Promise<{ seasonId: string }> }) {
  const raw = (await context.params).seasonId;
  const seasonId = Number(raw);
  return /^\d{1,10}$/.test(raw) && seasonId >= 1 && seasonId <= 0xffffffff ? seasonId : null;
}

export async function GET(request: Request, context: { params: Promise<{ seasonId: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const seasonId = await seasonIdFrom(context);
  if (!seasonId) return NextResponse.json({ error: "Temporada inválida." }, { status: 400 });
  try {
    const [detail, nextMissionId] = await Promise.all([getBattlePassSeason(seasonId), suggestMissionId(seasonId)]);
    return NextResponse.json({ detail, nextMissionId });
  } catch (error) {
    return battlePassErrorResponse(error, "Não foi possível ler a temporada.");
  }
}

export async function POST(request: Request, context: { params: Promise<{ seasonId: string }> }) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const seasonId = await seasonIdFrom(context);
  if (!seasonId) return NextResponse.json({ error: "Temporada inválida." }, { status: 400 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos para o Battle Pass." }, { status: 400 });

  const administrator = (await getAdminSession())?.username ?? "unknown";
  const target = String(seasonId);
  const audit = (action: Parameters<typeof writeAuditLog>[0]["action"], details: Record<string, unknown>) =>
    writeAuditLog({ administrator, action, target, details } as Parameters<typeof writeAuditLog>[0]).catch(() => undefined);

  try {
    const data = parsed.data;
    switch (data.action) {
      case "update": await updateSeason(seasonId, data.values); await audit("battlepass.season_update", { values: data.values }); break;
      case "activate": await activateSeason(seasonId); await audit("battlepass.season_activate", {}); break;
      case "deactivate": await deactivateSeason(seasonId); await audit("battlepass.season_deactivate", {}); break;
      case "delete": await deleteSeason(seasonId); await audit("battlepass.season_delete", {}); return NextResponse.json({ deleted: true });
      case "saveMission": await saveMission(seasonId, data.mission, data.mode); await audit("battlepass.mission_save", { mode: data.mode, mission: data.mission }); break;
      case "deleteMission": await deleteMission(seasonId, data.missionId); await audit("battlepass.mission_delete", { missionId: data.missionId }); break;
      case "saveReward": await saveReward(seasonId, data.reward, data.original); await audit("battlepass.reward_save", { reward: data.reward, original: data.original }); break;
      case "deleteReward": await deleteReward(seasonId, data.level, data.track); await audit("battlepass.reward_delete", { level: data.level, track: data.track }); break;
    }
    const [detail, nextMissionId] = await Promise.all([getBattlePassSeason(seasonId), suggestMissionId(seasonId)]);
    return NextResponse.json({ detail, nextMissionId });
  } catch (error) {
    return battlePassErrorResponse(error, "Não foi possível salvar a alteração do Battle Pass.");
  }
}
