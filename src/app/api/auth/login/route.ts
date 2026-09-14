import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearLoginAttempts,
  consumeLoginAttempt,
} from "@/lib/rate-limit";
import { hasSameOrigin, validateAdminCredentials } from "@/lib/security";
import { createAdminSession } from "@/lib/session";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  const headerStore = await headers();
  const clientKey =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = consumeLoginAttempt(clientKey);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Credenciais inválidas." }, { status: 400 });
  }

  if (!validateAdminCredentials(parsed.data.username, parsed.data.password)) {
    return NextResponse.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
  }

  clearLoginAttempts(clientKey);
  await createAdminSession(parsed.data.username);
  return NextResponse.json({ ok: true });
}
