import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { buildCorsHeaders } from "../../../lib/cors";
import { checkRateLimit, getClientKey } from "../../../lib/rateLimit";
import { sanitizeEmailInput } from "../../../lib/sanitize";
import { EmailInputSchema } from "../../../lib/schema";
import { analyzeEmailHeuristically } from "../../../lib/heuristicEngine";

export const runtime = "nodejs";

function jsonError(status: number, error: string, origin: string | null, extraHeaders?: HeadersInit) {
  return NextResponse.json(
    { error },
    { status, headers: { ...buildCorsHeaders(origin), ...extraHeaders } }
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  // --- Rate limiting -------------------------------------------------
  const clientKey = getClientKey(request.headers);
  const rateLimit = checkRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return jsonError(429, "Too many requests. Please slow down and try again shortly.", origin, {
      "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
    });
  }

  // --- Parse & validate body ------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON", origin);
  }

  const sanitized = sanitizeEmailInput(
    rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {}
  );

  let input;
  try {
    input = EmailInputSchema.parse(sanitized);
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, error.issues[0]?.message || "Invalid request", origin);
    }
    return jsonError(400, "Invalid request", origin);
  }

  // --- Analyze ----------------------------------------------------------
  // Fully local rule-based scoring: no external API calls, no per-email
  // cost, no network dependency, and it can never time out or get
  // rate-limited upstream because there is no upstream.
  try {
    const analysis = analyzeEmailHeuristically(input);
    return NextResponse.json(analysis, { headers: buildCorsHeaders(origin) });
  } catch (error) {
    console.error("Analysis error:", error instanceof Error ? error.message : error);
    return jsonError(500, "Failed to analyze email. Please try again in a moment.", origin);
  }
}
