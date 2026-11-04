import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { authorizeApiRequest } from "@/lib/security";
import { skillExportPath } from "@/lib/skill-batch";

export const runtime = "nodejs";

/** Entrega o .zip de uma exportação de lote: relatório + pack do cliente + RDF do servidor. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    const zipPath = skillExportPath(id);
    const fileStat = await stat(/* turbopackIgnore: true */ zipPath).catch(() => null);
    if (!fileStat?.isFile()) return NextResponse.json({ error: "Exportação não encontrada; ela pode ter sido substituída por exportações mais novas." }, { status: 404 });

    const stream = Readable.toWeb(createReadStream(zipPath)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `attachment; filename="mdbo-${id}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Falha ao entregar a exportação de skills", error);
    return NextResponse.json({ error: "Não foi possível entregar a exportação." }, { status: 400 });
  }
}
