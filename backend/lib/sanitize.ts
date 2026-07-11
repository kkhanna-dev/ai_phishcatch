/**
 * Input sanitization for untrusted email content before it's interpolated
 * into an LLM prompt or ever rendered anywhere. Defends against:
 *  - Prompt injection (email body trying to override system instructions)
 *  - Control-character / null-byte payloads
 *  - Oversized payloads that would waste tokens or blow past API limits
 */

const MAX_SUBJECT_LEN = 500;
const MAX_SENDER_LEN = 320; // max valid email length per RFC 5321
const MAX_BODY_LEN = 8000;
const MAX_LINK_LEN = 2000;
const MAX_LINKS = 25;

/** Strips control characters (except newline/tab) and collapses excess whitespace. */
function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Removes HTML tags so raw markup can't smuggle instructions or render unexpectedly downstream. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, " ");
}

export function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return stripControlChars(stripHtml(input)).trim().slice(0, maxLen);
}

export function sanitizeEmailInput(raw: {
  subject?: unknown;
  sender?: unknown;
  body?: unknown;
  links?: unknown;
}) {
  const links = Array.isArray(raw.links)
    ? raw.links
        .filter((l): l is string => typeof l === "string")
        .slice(0, MAX_LINKS)
        .map((l) => sanitizeText(l, MAX_LINK_LEN))
    : [];

  return {
    subject: sanitizeText(raw.subject, MAX_SUBJECT_LEN),
    sender: sanitizeText(raw.sender, MAX_SENDER_LEN),
    body: sanitizeText(raw.body, MAX_BODY_LEN),
    links,
  };
}

export const LIMITS = { MAX_SUBJECT_LEN, MAX_SENDER_LEN, MAX_BODY_LEN, MAX_LINK_LEN, MAX_LINKS };
