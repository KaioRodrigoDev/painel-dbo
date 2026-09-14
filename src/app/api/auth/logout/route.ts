import { NextResponse } from "next/server";

import { authorizeApiRequest } from "@/lib/security";
import { deleteAdminSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!(await authorizeApiRequest(request, true))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  await deleteAdminSession();
  return NextResponse.json({ ok: true });
}
