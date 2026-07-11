// PhishCatch Gmail API client.
//
// Used by the background service worker to silently read and label inbox
// messages via OAuth (chrome.identity), without ever opening a tab or
// requiring interaction beyond the one-time Google consent screen that
// Google itself requires for the first authorization.
//
// Loaded via importScripts() in background.js, so it exposes its API as a
// global (`self.PhishCatchGmail`) rather than using ES module exports.

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const FLAG_LABEL_NAME = "PhishCatch/Flagged";
const BULK_LABEL_NAME = "PhishCatch/Bulk";

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No Gmail auth token available"));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function gmailFetch(path, token, options = {}) {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    await removeCachedToken(token);
    throw new Error("Gmail authorization expired. Please reconnect in Settings.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

/** Finds (or creates) a Gmail label by name, returning its id. */
async function ensureLabel(token, name) {
  const { labels } = await gmailFetch("/labels", token);
  const existing = labels?.find((l) => l.name === name);
  if (existing) return existing.id;

  const created = await gmailFetch("/labels", token, {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

/** The "PhishCatch/Flagged" label used to mark risky mail. */
function ensureFlagLabel(token) {
  return ensureLabel(token, FLAG_LABEL_NAME);
}

/** The "PhishCatch/Bulk" label used to declutter routine bulk/promotional mail. */
function ensureBulkLabel(token) {
  return ensureLabel(token, BULK_LABEL_NAME);
}

async function listInboxMessageIds(token, { maxResults = 50, pageToken } = {}) {
  const params = new URLSearchParams({ labelIds: "INBOX", maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);

  const data = await gmailFetch(`/messages?${params.toString()}`, token);
  return { ids: (data.messages || []).map((m) => m.id), nextPageToken: data.nextPageToken || null };
}

/** Decodes Gmail's base64url message body encoding into a UTF-8 string. */
function decodeBase64Url(data) {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Walks a Gmail message payload (which can be arbitrarily nested multipart
 * MIME) to pull out plain text (preferred) or HTML body content, plus any
 * links found in the HTML. There's no DOM available in a service worker, so
 * link extraction and tag-stripping use regexes rather than a real parser.
 * That's fine here since the extracted text is only ever used as untrusted
 * input to the local heuristic scoring engine, never rendered as HTML.
 */
function extractBodyAndLinks(payload) {
  let plain = "";
  let html = "";

  (function walk(part) {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) plain += decodeBase64Url(part.body.data);
    else if (part.mimeType === "text/html" && part.body?.data) html += decodeBase64Url(part.body.data);
    (part.parts || []).forEach(walk);
  })(payload);

  if (!plain && !html && payload?.body?.data) {
    if (payload.mimeType === "text/html") html = decodeBase64Url(payload.body.data);
    else plain = decodeBase64Url(payload.body.data);
  }

  const links = [];
  if (html) {
    const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(html))) {
      const href = match[1];
      if (href && !href.startsWith("mailto:") && !href.includes("mail.google.com")) {
        links.push(href);
      }
    }
  }

  const bodyText = plain || html.replace(/<[^>]*>/g, " ");
  return { body: bodyText.trim().slice(0, 8000), links: [...new Set(links)].slice(0, 25) };
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

async function getMessage(token, id) {
  const msg = await gmailFetch(`/messages/${id}?format=full`, token);
  const headers = msg.payload?.headers || [];
  const { body, links } = extractBodyAndLinks(msg.payload);

  return {
    id: msg.id,
    subject: getHeader(headers, "Subject"),
    sender: getHeader(headers, "From"),
    body,
    links,
    internalDate: Number(msg.internalDate) || Date.now(),
    // Headers the bulk/promotional classifier keys off of (see bulk.js).
    listUnsubscribe: getHeader(headers, "List-Unsubscribe"),
    listId: getHeader(headers, "List-Id"),
    precedence: getHeader(headers, "Precedence"),
  };
}

/** Adds and/or removes labels on a message in a single modify call. */
async function modifyMessageLabels(token, id, { addLabelIds = [], removeLabelIds = [] } = {}) {
  await gmailFetch(`/messages/${id}/modify`, token, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

function labelMessage(token, id, labelId) {
  return modifyMessageLabels(token, id, { addLabelIds: [labelId] });
}

/**
 * Applies `labelId` and removes the message from the inbox (archives it), so
 * bulk/promotional clutter leaves the main inbox view but stays findable under
 * the label. Nothing is deleted; the action is fully reversible by the user.
 */
function archiveWithLabel(token, id, labelId) {
  return modifyMessageLabels(token, id, { addLabelIds: [labelId], removeLabelIds: ["INBOX"] });
}

self.PhishCatchGmail = {
  FLAG_LABEL_NAME,
  BULK_LABEL_NAME,
  getAuthToken,
  removeCachedToken,
  ensureLabel,
  ensureFlagLabel,
  ensureBulkLabel,
  listInboxMessageIds,
  getMessage,
  labelMessage,
  modifyMessageLabels,
  archiveWithLabel,
};
