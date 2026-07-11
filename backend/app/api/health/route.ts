import { NextRequest, NextResponse } from "next/server";
import { buildCorsHeaders } from "../../../lib/cors";
import { getEnv } from "../../../lib/env";

export const runtime = "nodejs";

const startedAt = Date.now();

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders(request.headers.get("origin")) });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  // Report whether required config is present without ever leaking values.
  let configured = true;
  try {
    getEnv();
  } catch {
    configured = false;
  }

  return NextResponse.json(
    {
      status: configured ? "ok" : "misconfigured",
      service: "phishcatch-api",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    },
    { headers: buildCorsHeaders(origin) }
  );
}
