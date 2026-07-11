/**
 * Simple in-memory sliding-window rate limiter.
 *
 * This is intentionally dependency-free (no Redis/Upstash/etc). It protects
 * a single running instance from abuse and accidental infinite-retry loops.
 * On serverless platforms with multiple concurrent instances the limit is
 * enforced per-instance rather than globally, acceptable for this project's
 * scale, and still far better than no limiting at all. If you need a hard
 * global limit across many instances, swap this module for a shared store.
 */
import { getEnv } from "./env";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically sweep expired buckets so the Map doesn't grow unbounded.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } = getEnv();
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const allowed = bucket.count <= RATE_LIMIT_MAX;
  return {
    allowed,
    limit: RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/** Best-effort client identifier for rate limiting purposes. */
export function getClientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") || "unknown";
}
