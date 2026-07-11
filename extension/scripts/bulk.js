// PhishCatch bulk / promotional mail classifier.
//
// A deliberately separate concern from the phishing scorer in heuristics.js.
// Bulk mail (job alerts, newsletters, LinkedIn/Indeed notifications, marketing
// lists) is not a security risk: no impersonation, no credential harvesting,
// no malicious links. It's just inbox clutter. This module decides whether a
// message is routine bulk mail so the monitor can move it under a
// "PhishCatch/Bulk" label and out of the main inbox view, leaving the phishing
// engine to focus only on genuinely dangerous mail.
//
// Every signal here is header/sender based, never a judgment about risk:
//   - RFC 2369 List-Unsubscribe / List-Id headers, which legitimate bulk
//     senders are expected to set. This is the single strongest marker of a
//     mailing-list message and catches the large majority of clutter.
//   - Precedence: bulk|list|junk (an older but still common bulk marker).
//   - Known bulk/notification sender domains and no-reply-style local parts,
//     used both as a fallback signal and to label the clutter with a friendly
//     category.
//
// Loaded via importScripts() in background.js, so it exposes its API as a
// global (self.PhishCatchBulk) rather than using ES module exports.

// Domains whose mail is essentially always bulk/notification traffic. Matched
// on the registrable-ish suffix so subdomains (e.g. e.linkedin.com) count too.
const BULK_DOMAINS = {
  job: [
    "linkedin.com",
    "indeed.com",
    "indeedemail.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "monster.com",
    "dice.com",
    "lever.co",
    "greenhouse.io",
    "wellfound.com",
  ],
  social: [
    "facebookmail.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "reddit.com",
    "reddithelp.com",
    "meetup.com",
    "nextdoor.com",
  ],
  newsletter: [
    "substack.com",
    "medium.com",
    "mailchimp.com",
    "mcsv.net",
    "rsgsv.net",
    "sendgrid.net",
    "beehiiv.com",
    "ghost.io",
  ],
  shopping: [
    "eventbrite.com",
    "groupon.com",
  ],
};

// Local-part patterns typical of automated bulk senders. These only *support*
// a bulk verdict; on their own a "no-reply" address is not enough, since plenty
// of transactional one-to-one mail also comes from no-reply addresses.
const BULK_LOCALPART_RE = /^(no-?reply|do-?not-?reply|newsletter|news|notifications?|updates?|mailer|marketing|promo|promotions?|offers?|deals?|digest|alerts?|jobs?-?(alerts?|listings?)?|info|hello|team|community|members?)([._+-]|$)/i;

/**
 * Returns { local, domain } for a sender address, lowercased, handling both
 * bare `a@b.com` and `Display Name <a@b.com>` forms.
 */
function splitAddress(from) {
  if (!from) return { local: "", domain: "" };
  const angle = from.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : from).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at === -1) return { local: "", domain: "" };
  return { local: addr.slice(0, at), domain: addr.slice(at + 1) };
}

/** True when `domain` equals or is a subdomain of `suffix`. */
function domainMatches(domain, suffix) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function categoryForDomain(domain) {
  if (!domain) return null;
  for (const [category, domains] of Object.entries(BULK_DOMAINS)) {
    if (domains.some((d) => domainMatches(domain, d))) return category;
  }
  return null;
}

/**
 * Classifies a message as bulk/promotional or not, purely from its sender and
 * a few RFC headers. Returns:
 *   { isBulk: boolean, category: string|null, reason: string }
 *
 * `category` is a coarse, human-friendly bucket ("job", "social",
 * "newsletter", "shopping", or "promotional") used only for display.
 */
function classifyBulk({ sender = "", listUnsubscribe = "", listId = "", precedence = "" } = {}) {
  const { local, domain } = splitAddress(sender);
  const knownCategory = categoryForDomain(domain);

  const hasListHeaders = Boolean(listUnsubscribe || listId);
  const bulkPrecedence = /\b(bulk|list|junk)\b/i.test(precedence);
  const bulkLocalPart = BULK_LOCALPART_RE.test(local);

  // A known bulk domain is decisive on its own. Otherwise we rely on the
  // standard mailing-list headers, optionally corroborated by the local part.
  const isBulk = Boolean(knownCategory) || hasListHeaders || bulkPrecedence;

  if (!isBulk) return { isBulk: false, category: null, reason: "" };

  const category = knownCategory || "promotional";

  let reason;
  if (knownCategory) reason = `Known ${knownCategory} sender (${domain})`;
  else if (hasListHeaders) reason = "Mailing-list message (List-Unsubscribe header)";
  else reason = "Bulk sender (Precedence header)";
  if (bulkLocalPart && !knownCategory) reason += `, from "${local}@…"`;

  return { isBulk: true, category, reason };
}

self.PhishCatchBulk = { classifyBulk };
