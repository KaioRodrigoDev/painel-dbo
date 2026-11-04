import { NextResponse } from "next/server";
import { z } from "zod";

import { BattlePassError } from "@/lib/battle-pass";

// Formatos aceitos pelas rotas do Battle Pass. Os limites finos (bytes do nome, regras por
// tipo de objetivo/recompensa) ficam em lib/battle-pass.ts, que é a mesma regra do servidor.

const dword = z.number().int().min(0).max(0xffffffff);

export const seasonValuesSchema = z.object({
  seasonId: z.number().int().min(1).max(0xffffffff),
  name: z.string().max(200),
  startTime: z.number().int().min(0),
  endTime: z.number().int().min(0),
  maxLevel: z.number().int().min(1).max(128),
  xpPerLevel: z.number().int().min(1).max(10_000_000),
  premiumPrice: dword,
  dayOffsetMinutes: z.number().int().min(-720).max(840),
});

export const missionValuesSchema = z.object({
  missionId: z.number().int().min(1).max(0xffffffff),
  name: z.string().max(300),
  releaseDay: z.number().int().min(0).max(65535),
  objective: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  targetId: dword,
  requiredAmount: z.number().int().min(1).max(0xffffffff),
  experience: z.number().int().min(1).max(0xffffffff),
  completionMobId: dword,
  transformation: z.number().int().min(0).max(255),
  worldId: dword,
  areaX: z.number().finite(),
  areaZ: z.number().finite(),
  areaRadius: z.number().finite().min(0),
});

export const rewardValuesSchema = z.object({
  level: z.number().int().min(1).max(128),
  track: z.union([z.literal(0), z.literal(1)]),
  rewardType: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  rewardId: dword,
  quantity: z.number().int().min(1).max(0xffffffff),
  titleDurationDays: z.number().int().min(0).max(36500),
  featured: z.boolean(),
});

/** Erro de regra vira 400 com a mensagem; banco desligado vira 503 com instrução. */
export function battlePassErrorResponse(error: unknown, fallback: string) {
  if (error instanceof BattlePassError) return NextResponse.json({ error: error.message }, { status: 400 });
  const code = (error as { code?: string })?.code;
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ER_ACCESS_DENIED_ERROR") {
    return NextResponse.json({ error: "O banco de personagens (mdbo_char) está inacessível. Ligue o MySQL e tente de novo." }, { status: 503 });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
