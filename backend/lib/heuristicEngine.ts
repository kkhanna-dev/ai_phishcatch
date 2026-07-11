/**
 * Rule-based phishing detection engine — no LLM, no external API calls, no
 * per-email cost. Everything here is a deterministic, explainable heuristic:
 * lookalike/spoofed sender domains, urgency and credential-harvesting
 * language, scam/lure phrasing, suspicious link shapes, and low-quality
 * writing patterns common in phishing templates.
 *
 * This produces the exact same `AnalysisResult` shape the old LLM-based
 * client did, so nothing downstream (API route, web UI, extension) needs to
 * change to consume it.
 *
 * IMPORTANT: `extension/scripts/heuristics.js` is a plain-JS port of this
 * same logic (the extension can't import TypeScript). Keep the two in sync
 * if you change scoring rules here.
 */
import { AnalysisResult, Severity } from "./schema";

export interface AnalyzeParams {
  subject: string;
  sender: string;
  body: string;
  links: string[];
}

interface Indicator {
  type: string;
  detail: string;
  severity: Severity;
  points: number;
}

const KNOWN_BRANDS = [
  "paypal.com", "apple.com", "microsoft.com", "amazon.com", "google.com", "netflix.com",
  "bankofamerica.com", "wellsfargo.com", "chase.com", "citibank.com", "americanexpress.com",
  "irs.gov", "usps.com", "fedex.com", "ups.com", "dhl.com", "linkedin.com", "facebook.com",
  "instagram.com", "twitter.com", "x.com", "dropbox.com", "docusign.com", "adobe.com",
  "office.com", "outlook.com", "icloud.com", "coinbase.com", "binance.com", "steampowered.com",
  "spotify.com", "ebay.com", "walmart.com", "target.com", "hsbc.com", "capitalone.com",
  "discover.com", "venmo.com", "zelle.com", "chime.com",
];

const URGENCY_PHRASES = [
  "urgent", "immediately", "act now", "act immediately", "right away",
  "as soon as possible", "within 24 hours", "within 48 hours",
  "account will be suspended", "account has been suspended", "account will be locked",
  "account will be closed", "verify your account", "confirm your identity",
  "unusual activity", "suspicious activity", "unauthorized access",
  "your account is at risk", "failure to comply", "final notice", "last warning",
  "limited time", "expires today", "expires soon", "immediate action required",
];

const CREDENTIAL_PHRASES = [
  "enter your password", "confirm your password", "login to verify",
  "re-enter your password", "enter your ssn", "social security number",
  "confirm your credit card", "enter your card number", "enter your pin",
  "update your billing information", "verify your payment method",
  "confirm your bank details", "enter your username and password",
];

const LURE_PHRASES = [
  "you have won", "you've won", "congratulations you", "claim your prize",
  "claim your reward", "free gift", "no cost to you", "risk free",
  "wire transfer", "bitcoin", "cryptocurrency payment", "gift card codes",
  "western union", "inheritance", "lottery winner", "tax refund", "unclaimed funds",
];

const GENERIC_GREETINGS = [
  "dear customer", "dear user", "dear valued customer", "dear account holder",
  "dear member", "dear sir/madam", "dear client",
];

const COMMON_MISSPELLINGS = [
  "recieve", "seperate", "occured", "untill", "adress", "wich", "goverment",
  "becuase", "immediatly", "verifiy", "accsount", "informations", "kindly click",
  "kindly confirm", "do the needful",
];

const SHORTENER_DOMAINS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at",
];

const SUSPICIOUS_TLDS = [
  ".tk", ".ml", ".ga", ".cf", ".gq", ".top", ".xyz", ".click", ".link",
  ".surf", ".rest", ".icu", ".loan", ".work",
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function getRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
}

/** Normalizes common leetspeak/homoglyph substitutions used to fake brand names. */
function normalizeHomoglyphs(s: string): string {
  return s
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a");
}

/**
 * Checks whether `brandName` appears as a distinct token in `text` (bounded
 * by start/end of string or non-word characters like "." "-" or a space) —
 * not merely as a substring. Without this, a short brand name like "x"
 * (from x.com) would false-positive on any word containing that letter,
 * e.g. "Alex" or "example.com".
 */
function containsBrandToken(text: string, brandName: string): boolean {
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function extractEmailAddress(sender: string): { displayName: string; domain: string; address: string } {
  const match = sender.match(/<([^>]+)>/);
  const address = (match ? match[1] : sender).trim().toLowerCase();
  const displayName = (match ? sender.slice(0, sender.indexOf("<")) : "").trim().toLowerCase();
  const atIndex = address.lastIndexOf("@");
  const domain = atIndex >= 0 ? address.slice(atIndex + 1) : "";
  return { displayName, domain, address };
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** Checks a domain against the known-brand list for impersonation/lookalikes. */
function checkDomainAgainstBrands(domain: string): { brand: string; reason: "impersonation" | "lookalike" } | null {
  if (!domain) return null;
  const registrable = getRegistrableDomain(domain);

  for (const brand of KNOWN_BRANDS) {
    if (registrable === brand) return null; // exact match to a real brand domain — trusted
  }

  for (const brand of KNOWN_BRANDS) {
    const brandName = brand.split(".")[0];
    if (containsBrandToken(normalizeHomoglyphs(domain), brandName) && registrable !== brand) {
      return { brand, reason: "impersonation" };
    }
  }

  for (const brand of KNOWN_BRANDS) {
    const distance = levenshtein(registrable, brand);
    if (distance > 0 && distance <= 2 && Math.abs(registrable.length - brand.length) <= 2) {
      return { brand, reason: "lookalike" };
    }
  }

  return null;
}

function pushIndicator(indicators: Indicator[], type: string, detail: string, severity: Severity, points: number) {
  indicators.push({ type, detail, severity, points });
}

export function analyzeEmailHeuristically(params: AnalyzeParams): AnalysisResult {
  const subject = params.subject || "";
  const body = params.body || "";
  const sender = params.sender || "";
  const links = params.links || [];
  const lowerBody = body.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const combinedText = `${lowerSubject} ${lowerBody}`;

  const indicators: Indicator[] = [];

  // --- Sender spoofing / brand impersonation -----------------------------
  const { displayName, domain } = extractEmailAddress(sender);
  const domainMatch = checkDomainAgainstBrands(domain);
  if (domainMatch) {
    if (domainMatch.reason === "impersonation") {
      pushIndicator(
        indicators,
        "Brand Impersonation",
        `Sender domain "${domain}" references "${domainMatch.brand}" but isn't the real domain`,
        "high",
        35
      );
    } else {
      pushIndicator(
        indicators,
        "Lookalike Domain",
        `Sender domain "${domain}" closely resembles "${domainMatch.brand}"`,
        "high",
        30
      );
    }
  }

  if (displayName) {
    for (const brand of KNOWN_BRANDS) {
      const brandName = brand.split(".")[0];
      if (containsBrandToken(displayName, brandName) && getRegistrableDomain(domain) !== brand) {
        pushIndicator(
          indicators,
          "Display Name Mismatch",
          `Display name references "${brandName}" but the email address domain doesn't match`,
          "high",
          25
        );
        break;
      }
    }
  }

  // --- Credential harvesting phrases --------------------------------------
  let credentialPoints = 0;
  for (const phrase of CREDENTIAL_PHRASES) {
    if (combinedText.includes(phrase)) {
      pushIndicator(indicators, "Credential Request", `Asks recipient to "${phrase}"`, "high", 0);
      credentialPoints += 20;
    }
  }
  if (credentialPoints > 0) {
    indicators[indicators.length - 1].points = Math.min(credentialPoints, 40);
  }

  // --- Urgency / pressure tactics ------------------------------------------
  const urgencyHits = URGENCY_PHRASES.filter((p) => combinedText.includes(p));
  if (urgencyHits.length > 0) {
    pushIndicator(
      indicators,
      "Urgency Tactic",
      `Uses pressure language: "${urgencyHits.slice(0, 2).join('", "')}"`,
      "medium",
      Math.min(urgencyHits.length * 8, 30)
    );
  }

  // --- Financial / too-good-to-be-true lures --------------------------------
  const lureHits = LURE_PHRASES.filter((p) => combinedText.includes(p));
  if (lureHits.length > 0) {
    pushIndicator(
      indicators,
      "Scam Lure",
      `Contains scam-typical phrasing: "${lureHits.slice(0, 2).join('", "')}"`,
      "high",
      Math.min(lureHits.length * 15, 30)
    );
  }

  // --- Generic greeting ------------------------------------------------------
  if (GENERIC_GREETINGS.some((g) => combinedText.includes(g))) {
    pushIndicator(indicators, "Generic Greeting", "Uses an impersonal greeting instead of your name", "low", 5);
  }

  // --- Common phishing-template misspellings ---------------------------------
  const misspellingHits = COMMON_MISSPELLINGS.filter((w) => combinedText.includes(w));
  if (misspellingHits.length > 0) {
    pushIndicator(
      indicators,
      "Writing Quality",
      `Contains common phishing-template wording: "${misspellingHits.slice(0, 3).join('", "')}"`,
      "low",
      Math.min(misspellingHits.length * 3, 15)
    );
  }

  // --- Aggressive subject formatting --------------------------------------
  const exclamationCount = countOccurrences(subject, "!");
  const letters = subject.replace(/[^a-zA-Z]/g, "");
  const upperRatio = letters.length > 5 ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
  if (exclamationCount >= 3 || upperRatio > 0.7) {
    pushIndicator(indicators, "Aggressive Formatting", "Subject line uses excessive caps or punctuation", "low", 8);
  }

  // --- Attachment / download risk keywords --------------------------------
  if (/(open the attach|download the attach|\.exe\b|\.scr\b|enable macros)/i.test(body)) {
    pushIndicator(indicators, "Attachment Risk", "References opening an attachment or enabling macros", "medium", 15);
  }

  // --- Suspicious links -----------------------------------------------------
  let linkPoints = 0;
  const senderRegistrable = getRegistrableDomain(domain);
  let sawMismatchedLinkDomain = false;

  for (const link of links) {
    const hostname = safeHostname(link);
    if (!hostname) continue;

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      pushIndicator(indicators, "Suspicious Link", `Link points to a raw IP address (${hostname})`, "high", 0);
      linkPoints += 20;
      continue;
    }

    if (hostname.includes("xn--")) {
      pushIndicator(indicators, "Suspicious Link", `Link uses punycode encoding (${hostname}) — possible homograph attack`, "high", 0);
      linkPoints += 20;
      continue;
    }

    if (SHORTENER_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      pushIndicator(indicators, "Suspicious Link", `Link uses a URL shortener (${hostname}) that hides the real destination`, "medium", 0);
      linkPoints += 12;
      continue;
    }

    if (SUSPICIOUS_TLDS.some((tld) => hostname.endsWith(tld))) {
      pushIndicator(indicators, "Suspicious Link", `Link uses a high-abuse TLD (${hostname})`, "medium", 0);
      linkPoints += 10;
    }

    const linkMatch = checkDomainAgainstBrands(hostname);
    if (linkMatch) {
      pushIndicator(
        indicators,
        "Suspicious Link",
        `Link domain "${hostname}" ${linkMatch.reason === "impersonation" ? "references" : "closely resembles"} "${linkMatch.brand}"`,
        "high",
        0
      );
      linkPoints += 20;
    }

    const registrableLink = getRegistrableDomain(hostname);
    if (senderRegistrable && registrableLink !== senderRegistrable && !sawMismatchedLinkDomain) {
      const senderIsKnownBrand = KNOWN_BRANDS.includes(senderRegistrable);
      if (senderIsKnownBrand && registrableLink !== senderRegistrable) {
        pushIndicator(indicators, "Link/Sender Mismatch", `Link domain doesn't match the sender's domain (${senderRegistrable})`, "medium", 15);
        linkPoints += 15;
        sawMismatchedLinkDomain = true;
      }
    }
  }
  linkPoints = Math.min(linkPoints, 45);

  // --- Aggregate score -------------------------------------------------------
  // Link-related indicators are pushed with points=0 and tracked separately in
  // `linkPoints` (capped) to avoid a single email with many links dominating
  // the score; every other indicator contributes its points directly.
  const nonLinkScore = indicators
    .filter((i) => i.type !== "Suspicious Link" && i.type !== "Link/Sender Mismatch")
    .reduce((sum, i) => sum + i.points, 0);
  const finalLinkScore = Math.min(linkPoints, 45);

  const score = Math.max(0, Math.min(100, Math.round(nonLinkScore + finalLinkScore)));
  const verdict = score <= 30 ? "SAFE" : score <= 65 ? "SUSPICIOUS" : "DANGEROUS";

  // --- Build summary -----------------------------------------------------
  const topIndicators = [...indicators]
    .sort((a, b) => (b.points || 5) - (a.points || 5))
    .slice(0, 2)
    .map((i) => i.type);

  const summary =
    verdict === "SAFE"
      ? "No significant phishing indicators detected."
      : `Flagged for: ${topIndicators.join(", ") || "multiple minor indicators"}.`;

  const recommendations =
    verdict === "SAFE"
      ? ["No action needed — this email doesn't show signs of phishing.", "Still verify sender identity before sharing sensitive info."]
      : verdict === "SUSPICIOUS"
      ? [
          "Don't click links or download attachments until you verify the sender.",
          "Contact the organization directly using a known official number or website.",
          "Report to your IT/security team if this is a work account.",
        ]
      : [
          "Do not click any links or reply.",
          "Do not enter any credentials or personal information.",
          "Report this email as phishing and delete it.",
          "If you already clicked a link or entered info, change your passwords immediately.",
        ];

  const dedupedIndicators = Object.values(
    indicators.reduce<Record<string, Indicator>>((acc, ind) => {
      const key = `${ind.type}:${ind.detail}`;
      if (!acc[key]) acc[key] = ind;
      return acc;
    }, {})
  ).slice(0, 12);

  return {
    score,
    verdict,
    summary,
    indicators: dedupedIndicators.map(({ type, detail, severity }) => ({ type, detail, severity })),
    recommendations,
  };
}
