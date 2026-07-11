/**
 * CORS handling with an explicit allow-list instead of a blanket
 * `Access-Control-Allow-Origin: *`. This matters here because the API
 * accepts POST requests carrying (potentially sensitive) email content —
 * a wildcard origin would let any website's JS silently relay traffic
 * through a visitor's browser.
 *
 * Configure allowed origins via ALLOWED_ORIGINS (comma separated), e.g.:
 *   ALLOWED_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop,https://phishcatch.example.com
 *
 * If ALLOWED_ORIGINS is unset, requests are still served (so local dev and
 * same-origin server-rendered pages keep working) but no explicit
 * Access-Control-Allow-Origin is reflected for cross-origin callers.
 */
import { getAllowedOrigins, isProduction } from "./env";

export function resolveCorsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;

  const allowed = getAllowedOrigins();

  if (allowed.includes(requestOrigin)) return requestOrigin;

  // Convenience for local development only — never in production.
  if (!isProduction() && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

export function buildCorsHeaders(requestOrigin: string | null): HeadersInit {
  const origin = resolveCorsOrigin(requestOrigin);
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}
