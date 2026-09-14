import { NextResponse } from "next/server";

import { loadItemIcon } from "@/lib/item-icons";
import { authorizeApiRequest } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const { name } = await params;
    const icon = await loadItemIcon(decodeURIComponent(name));
    if (!icon || icon.contentType === "image/vnd-ms.dds") {
      return NextResponse.json({ error: "Ícone não disponível para o navegador." }, { status: 404 });
    }
    return new Response(new Uint8Array(icon.buffer), {
      headers: {
        "Content-Type": icon.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Falha ao carregar ícone de item", error);
    return NextResponse.json({ error: "Não foi possível carregar o ícone." }, { status: 404 });
  }
}
