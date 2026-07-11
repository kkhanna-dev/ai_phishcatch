/**
 * Centralized environment configuration with validation.
 * Fails fast (with a clear error) instead of letting bad config surface as
 * confusing runtime errors deep inside a request handler.
 */
import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ALLOWED_ORIGINS: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  NODE_ENV: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parses and validates process.env once, caching the result. */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Parsed allow-list of origins permitted to call the API cross-origin. */
export function getAllowedOrigins(): string[] {
  const { ALLOWED_ORIGINS } = getEnv();
  if (!ALLOWED_ORIGINS) return [];
  return ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
