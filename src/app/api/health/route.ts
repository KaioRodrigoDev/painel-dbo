import { NextResponse } from "next/server";

import { checkDatabaseConnections } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/security";

export async function GET(request: Request) {
  if (!(await authorizeApiRequest(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    await checkDatabaseConnections();
    return NextResponse.json({ status: "ok", databases: "connected" });
  } catch {
    return NextResponse.json(
      { status: "degraded", databases: "unavailable" },
      { status: 503 },
    );
  }
}
