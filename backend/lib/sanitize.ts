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

/**
 * Sanitizes a "From" header value like `Display Name <user@example.com>` or
 * a bare `user@example.com`. The generic stripHtml() above treats any
 * `<...>` as an HTML tag and deletes it — which would silently destroy the
 * bracketed email address (and with it, the sender's domain, which most
 * phishing heuristics depend on). This preserves a trailing `<...@...>`
 * address while still stripping HTML from the display-name portion.
 */
export function sanitizeSender(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  const raw = stripControlChars(input).trim().slice(0, maxLen);

  const match = raw.match(/^(.*)<([^<>]*@[^<>]*)>\s*$/);
  if (match) {
    const displayName = stripHtml(match[1]).trim();
    const email = match[2].trim();
    return (displayName ? `${displayName} <${email}>` : email).slice(0, maxLen);
  }

  return sanitizeText(raw, maxLen);
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
    sender: sanitizeSender(raw.sender, MAX_SENDER_LEN),
    body: sanitizeText(raw.body, MAX_BODY_LEN),
    links,
  };
}

export const LIMITS = { MAX_SUBJECT_LEN, MAX_SENDER_LEN, MAX_BODY_LEN, MAX_LINK_LEN, MAX_LINKS };
