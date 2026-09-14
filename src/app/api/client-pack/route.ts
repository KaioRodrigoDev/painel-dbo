import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { authorizeApiRequest } from "@/lib/security";
import { skillPackDownloadDirectory } from "@/lib/skill-rdf-publisher";

export const runtime = "nodejs";

// Entrega a copia ja corrigida do pack preparada durante a publicacao de um rascunho.
// O jogador substitui esse arquivo na pasta pack da instalacao dele.
export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const draftId = new URL(request.url).searchParams.get("draft") ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(draftId)) return NextResponse.json({ error: "Rascunho inválido." }, { status: 400 });

  try {
    const directory = skillPackDownloadDirectory(draftId);
    const [fileName] = await readdir(/* turbopackIgnore: true */ directory).catch(() => [] as string[]);
    if (!fileName) return NextResponse.json({ error: "Nenhum pack preparado para este rascunho. Publique novamente marcando a opção de baixar." }, { status: 404 });

    const filePath = path.join(directory, fileName);
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Falha ao entregar o pack do cliente", error);
    return NextResponse.json({ error: "Não foi possível entregar o pack do cliente." }, { status: 400 });
  }
}
