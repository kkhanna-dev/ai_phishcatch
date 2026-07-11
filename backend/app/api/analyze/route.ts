import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { buildCorsHeaders } from "../../../lib/cors";
import { checkRateLimit, getClientKey } from "../../../lib/rateLimit";
import { sanitizeEmailInput } from "../../../lib/sanitize";
import { EmailInputSchema } from "../../../lib/schema";
import { analyzeEmailWithClaude } from "../../../lib/anthropicClient";

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
  try {
    const analysis = await analyzeEmailWithClaude(input);
    return NextResponse.json(analysis, { headers: buildCorsHeaders(origin) });
  } catch (error) {
    console.error("Analysis error:", error instanceof Error ? error.message : error);

    if (error instanceof Anthropic.APIError && error.status === 401) {
      // Never leak whether/why the upstream key is invalid to the client.
      return jsonError(502, "Analysis service is temporarily unavailable", origin);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return jsonError(504, "Analysis timed out. Please try again.", origin);
    }

    return jsonError(502, "Failed to analyze email. Please try again in a moment.", origin);
  }
}
