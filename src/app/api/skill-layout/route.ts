import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { listSkillLayoutClasses, loadSkillLayout, previewSkillLayout, publishSkillLayout } from "@/lib/skill-layout";
import { resolveRequestedPackDirectory } from "@/lib/skill-pack-publisher";

export const runtime = "nodejs";

const placementSchema = z.object({ column: z.number().int().min(0).max(64), row: z.number().int().min(0).max(256), tblidx: z.number().int().positive().nullable() });
const lineSchema = z.object({
  column: z.number().int().min(0).max(64),
  row: z.number().int().min(0).max(256),
  line: z
    .object({
      kind: z.enum(["UpgradeLine", "OptionLine"]),
      beginSkill: z.number().int().positive(),
      endSkill: z.number().int().positive(),
      beginAttach: z.enum(["up", "down", "Left", "right"]),
      endAttach: z.enum(["up", "down", "Left", "right"]),
    })
    .nullable(),
});
const publishSchema = z.object({
  classIndex: z.number().int().min(0).max(110),
  placements: z.array(placementSchema).max(4096),
  lines: z.array(lineSchema).max(4096).default([]),
  clientPackDirectory: z.string().max(4096).nullish(),
  confirm: z.boolean().default(false),
});

// GET sem parametros lista as classes disponiveis; com ?class=N devolve a arvore dela.
// POST sem confirm devolve o previa das mudancas; com confirm grava no pack.
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "NÃ£o autorizado." }, { status: 401 });
  try {
    const raw = new URL(request.url).searchParams.get("class");
    if (raw === null) return NextResponse.json({ classes: await listSkillLayoutClasses() });

    const classIndex = Number(raw);
    if (!Number.isInteger(classIndex) || classIndex < 0 || classIndex > 110) return NextResponse.json({ error: "Classe invÃ¡lida." }, { status: 400 });
    return NextResponse.json({ layout: await loadSkillLayout(classIndex) });
  } catch (error) {
    console.error("Falha ao carregar a Ã¡rvore de skills", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "NÃ£o foi possÃ­vel carregar a Ã¡rvore." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) return NextResponse.json({ error: "NÃ£o autorizado." }, { status: 401 });
  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "RequisiÃ§Ã£o invÃ¡lida." }, { status: 400 });

  try {
    const directory = await resolveRequestedPackDirectory(parsed.data.clientPackDirectory);
    if (!parsed.data.confirm) {
      const { changes, lineChanges, blockingIssues } = await previewSkillLayout(parsed.data.classIndex, parsed.data.placements, parsed.data.lines, directory);
      return NextResponse.json({ preview: { changes, lineChanges, blockingIssues, packDirectory: directory } });
    }

    const session = await getAdminSession();
    const administrator = session?.username ?? "unknown";
    const result = await publishSkillLayout(parsed.data.classIndex, parsed.data.placements, parsed.data.lines, {
      backupDirectory: path.join(process.cwd(), "data", "skill-layout-backups"),
      label: `class-${parsed.data.classIndex}`,
      directory,
    });

    await writeAuditLog({
      administrator,
      action: "skills.layout_publish",
      target: result.packedPath,
      details: { classIndex: parsed.data.classIndex, packFile: result.packFile, backups: result.backups.map((backup) => path.basename(backup)), sha256: result.files[0]?.sha256 ?? null },
    }).catch((error) => console.error("Falha ao auditar publicaÃ§Ã£o de layout", error));

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Falha ao publicar a Ã¡rvore de skills", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "NÃ£o foi possÃ­vel publicar a Ã¡rvore." }, { status: 400 });
  }
}
