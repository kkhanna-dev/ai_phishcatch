import { z } from "zod";
import { LIMITS } from "./sanitize";

/** Shape of the request body accepted by POST /api/analyze. */
export const EmailInputSchema = z
  .object({
    subject: z.string().max(LIMITS.MAX_SUBJECT_LEN).optional().default(""),
    sender: z.string().max(LIMITS.MAX_SENDER_LEN).optional().default(""),
    body: z.string().max(LIMITS.MAX_BODY_LEN).optional().default(""),
    links: z.array(z.string().max(LIMITS.MAX_LINK_LEN)).max(LIMITS.MAX_LINKS).optional().default([]),
  })
  .refine((data) => data.subject.trim().length > 0 || data.body.trim().length > 0, {
    message: "Email body or subject is required",
  });

export type EmailInput = z.infer<typeof EmailInputSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export const VerdictSchema = z.enum(["SAFE", "SUSPICIOUS", "DANGEROUS"]);

/** Shape the LLM response must conform to. Anything else is rejected. */
export const AnalysisResultSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  verdict: VerdictSchema,
  summary: z.string().min(1).max(500),
  indicators: z
    .array(
      z.object({
        type: z.string().min(1).max(120),
        detail: z.string().min(1).max(500),
        severity: SeveritySchema,
      })
    )
    .max(20)
    .default([]),
  recommendations: z.array(z.string().min(1).max(300)).max(10).default([]),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
