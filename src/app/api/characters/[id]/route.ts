import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requestCharacterUpdate } from "@/lib/db";
import { getAdminConfig } from "@/lib/env";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

const unsignedInteger = z.number().int().min(0).max(4_294_967_295);

const updateSchema = z.object({
  level: z.number().int().min(1),
  experience: unsignedInteger,
  skillPoints: unsignedInteger,
  money: unsignedInteger,
  cash: unsignedInteger,
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await authorizeApiRequest(request, true))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const characterId = Number(id);
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "Personagem inválido." }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Valores inválidos para o personagem." },
      { status: 400 },
    );
  }
  if (parsed.data.level > getAdminConfig().maxCharacterLevel) {
    return NextResponse.json(
      { error: `O nível máximo configurado é ${getAdminConfig().maxCharacterLevel}.` },
      { status: 400 },
    );
  }

  try {
    const session = await getAdminSession();
    const administrator = session?.username ?? "admin";
    const result = await requestCharacterUpdate(characterId, parsed.data, administrator);
    if (!result.ok) {
      return NextResponse.json({ error: "Personagem não encontrado." }, { status: 404 });
    }

    try {
      await writeAuditLog({
        administrator,
        action: "character.update.requested",
        characterId,
        characterName: result.character.name,
        previous: result.previous,
        next: parsed.data,
      });
    } catch (auditError) {
      console.error("Solicitação criada, mas o arquivo de auditoria falhou", auditError);
    }

    return NextResponse.json({
      character: result.character,
      updateId: result.updateId,
      message: "Solicitação registrada. O QueryServer aplicará os valores com segurança.",
    });
  } catch (error) {
    console.error("Falha ao atualizar personagem", error);
    return NextResponse.json(
      { error: "Não foi possível atualizar o personagem." },
      { status: 500 },
    );
  }
}
