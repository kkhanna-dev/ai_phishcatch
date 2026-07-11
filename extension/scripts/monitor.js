// PhishCatch autonomous inbox monitor.
//
// After a one-time Gmail connection (the single user gesture Google's OAuth
// flow requires), this silently scans mail on a schedule with zero further
// interaction:
//   1. A one-time catch-up scan of recent inbox history (~150 messages).
//   2. A recurring poll (chrome.alarms, since MV3 service workers cannot use
//      setInterval reliably) that checks for new mail every few minutes.
//
// Two independent things happen to each message:
//
//   1. Security: anything the local heuristic engine scores as DANGEROUS gets
//      the "PhishCatch/Flagged" label. Flagged mail is never archived, moved
//      to Spam, or deleted; it stays in the inbox and simply becomes easy to
//      find later.
//
//   2. Declutter: anything the bulk classifier (bulk.js) recognizes as routine
//      bulk/promotional mail (job alerts, newsletters, LinkedIn/Indeed
//      notifications) gets the "PhishCatch/Bulk" label. Bulk mail that the
//      phishing engine considers SAFE is also archived out of the inbox view
//      (the INBOX label is removed) so the inbox stays clean. This is
//      reversible: nothing is deleted, and the mail stays findable under the
//      label. Mail that is anything but SAFE is labeled but left in the inbox,
//      so a suspicious or dangerous message is never hidden.
//
// Loaded via importScripts() in background.js, exposes a global instead of
// using ES module exports.

const POLL_ALARM_NAME = "phishcatch-poll";
const POLL_PERIOD_MINUTES = 5;
const CATCHUP_MAX_MESSAGES = 150;
const CATCHUP_PAGE_SIZE = 50;
const POLL_BATCH_SIZE = 25;
// Analysis itself is instant and local now (no LLM/API call), so this only
// needs to be gentle on the Gmail API's per-user quota, not an AI provider.
const THROTTLE_MS = 250;
const FLAG_VERDICTS = ["DANGEROUS"];
const MAX_SCANNED_IDS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getScannedIds() {
  const { scannedMessageIds } = await chrome.storage.local.get(["scannedMessageIds"]);
  return new Set(scannedMessageIds || []);
}

async function saveScannedIds(idSet) {
  const ids = Array.from(idSet).slice(-MAX_SCANNED_IDS);
  await chrome.storage.local.set({ scannedMessageIds: ids });
}

async function bumpCount(key) {
  const stored = await chrome.storage.local.get([key]);
  await chrome.storage.local.set({ [key]: (stored[key] || 0) + 1 });
}

/**
 * Fetches and analyzes a single message, then, independently:
 *   - flags it if the phishing engine scores it DANGEROUS, and
 *   - labels (and, when SAFE, archives) it if it's routine bulk/promotional.
 */
async function processMessage(token, labels, id, scannedIds) {
  const { flagLabelId, bulkLabelId } = labels;

  let message;
  try {
    message = await self.PhishCatchGmail.getMessage(token, id);
  } catch (err) {
    console.error(`PhishCatch: failed to fetch message ${id}:`, err.message);
    scannedIds.add(id); // Don't retry a permanently-broken message forever.
    return;
  }

  let result;
  try {
    result = self.PhishCatchHeuristics.analyze({
      subject: message.subject,
      sender: message.sender,
      body: message.body,
      links: message.links,
    });
  } catch (err) {
    console.error(`PhishCatch: analysis failed for message ${id}:`, err.message);
    return;
  }

  scannedIds.add(id);

  await self.PhishCatchHistory.addToHistory({
    ...result,
    subject: message.subject,
    sender: message.sender,
    timestamp: message.internalDate || Date.now(),
    id: `gmail-${id}`,
    source: "auto",
  });

  if (FLAG_VERDICTS.includes(result.verdict)) {
    try {
      await self.PhishCatchGmail.labelMessage(token, id, flagLabelId);
      await bumpCount("monitorFlaggedCount");
    } catch (err) {
      console.error(`PhishCatch: failed to label message ${id}:`, err.message);
    }
  }

  // Declutter pass, independent of the phishing verdict above. Dangerous mail
  // is never hidden, so only SAFE bulk mail is archived out of the inbox;
  // anything else is labeled in place.
  if (bulkLabelId) await applyBulkLabel(token, bulkLabelId, id, message, result);
}

/** Labels bulk/promotional mail and archives it when the message is SAFE. */
async function applyBulkLabel(token, bulkLabelId, id, message, result) {
  let bulk;
  try {
    bulk = self.PhishCatchBulk.classifyBulk({
      sender: message.sender,
      subject: message.subject,
      listUnsubscribe: message.listUnsubscribe,
      listId: message.listId,
      precedence: message.precedence,
    });
  } catch (err) {
    console.error(`PhishCatch: bulk classification failed for message ${id}:`, err.message);
    return;
  }
  if (!bulk.isBulk) return;

  const archive = result.verdict === "SAFE";
  try {
    if (archive) await self.PhishCatchGmail.archiveWithLabel(token, id, bulkLabelId);
    else await self.PhishCatchGmail.labelMessage(token, id, bulkLabelId);
    await bumpCount("monitorBulkCount");
  } catch (err) {
    console.error(`PhishCatch: failed to declutter message ${id}:`, err.message);
  }
}

/** One-time gesture: authorize Gmail access and start protection. */
async function connect() {
  const token = await self.PhishCatchGmail.getAuthToken(true);
  const flagLabelId = await self.PhishCatchGmail.ensureFlagLabel(token);
  const bulkLabelId = await self.PhishCatchGmail.ensureBulkLabel(token);

  await chrome.storage.local.set({
    gmailConnected: true,
    flagLabelId,
    bulkLabelId,
    monitorFlaggedCount: 0,
    monitorBulkCount: 0,
  });

  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });

  // Run the catch-up scan in the background without blocking the popup.
  // Scanning ~150 emails can take a couple of minutes.
  runCatchUpScan(token, { flagLabelId, bulkLabelId }).catch((err) =>
    console.error("PhishCatch catch-up scan failed:", err.message)
  );

  return { connected: true };
}

async function disconnect() {
  try {
    const token = await self.PhishCatchGmail.getAuthToken(false);
    if (token) await self.PhishCatchGmail.removeCachedToken(token);
  } catch {
    // Not fatal, we're disconnecting anyway.
  }
  chrome.alarms.clear(POLL_ALARM_NAME);
  await chrome.storage.local.set({ gmailConnected: false });
  return { connected: false };
}

/** Re-registers the polling alarm after a browser restart / SW wake-up. */
async function resumeIfConnected() {
  const { gmailConnected } = await chrome.storage.local.get(["gmailConnected"]);
  if (gmailConnected) {
    chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  }
}

async function getStatus() {
  const stored = await chrome.storage.local.get([
    "gmailConnected",
    "lastScanAt",
    "monitorFlaggedCount",
    "monitorBulkCount",
    "catchUpInProgress",
    "catchUpProgress",
  ]);
  return {
    connected: !!stored.gmailConnected,
    lastScanAt: stored.lastScanAt || null,
    flaggedCount: stored.monitorFlaggedCount || 0,
    bulkCount: stored.monitorBulkCount || 0,
    catchUpInProgress: !!stored.catchUpInProgress,
    catchUpProgress: stored.catchUpProgress || null,
  };
}

async function runCatchUpScan(token, labels) {
  await chrome.storage.local.set({
    catchUpInProgress: true,
    catchUpProgress: { scanned: 0, total: CATCHUP_MAX_MESSAGES },
  });

  const scannedIds = await getScannedIds();
  let pageToken;
  let processed = 0;

  try {
    while (processed < CATCHUP_MAX_MESSAGES) {
      const { ids, nextPageToken } = await self.PhishCatchGmail.listInboxMessageIds(token, {
        maxResults: CATCHUP_PAGE_SIZE,
        pageToken,
      });

      if (ids.length === 0) break;

      for (const id of ids) {
        if (processed >= CATCHUP_MAX_MESSAGES) break;
        if (!scannedIds.has(id)) {
          await processMessage(token, labels, id, scannedIds);
          await saveScannedIds(scannedIds);
          await sleep(THROTTLE_MS);
        }
        processed += 1;
        await chrome.storage.local.set({ catchUpProgress: { scanned: processed, total: CATCHUP_MAX_MESSAGES } });
      }

      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }
  } finally {
    await chrome.storage.local.set({ catchUpInProgress: false, lastScanAt: Date.now() });
  }
}

/** Runs on a chrome.alarms schedule; checks for and scans new inbox mail. */
async function runPollCycle() {
  const stored = await chrome.storage.local.get(["gmailConnected", "flagLabelId", "bulkLabelId"]);
  if (!stored.gmailConnected) return;

  let token;
  try {
    token = await self.PhishCatchGmail.getAuthToken(false);
  } catch (err) {
    console.error("PhishCatch: silent auth failed, monitor paused until reconnect:", err.message);
    return;
  }

  const flagLabelId = stored.flagLabelId || (await self.PhishCatchGmail.ensureFlagLabel(token));
  const bulkLabelId = stored.bulkLabelId || (await self.PhishCatchGmail.ensureBulkLabel(token));
  if (!stored.bulkLabelId) await chrome.storage.local.set({ bulkLabelId });
  const scannedIds = await getScannedIds();

  const { ids } = await self.PhishCatchGmail.listInboxMessageIds(token, { maxResults: POLL_BATCH_SIZE });
  const newIds = ids.filter((id) => !scannedIds.has(id));

  for (const id of newIds) {
    await processMessage(token, { flagLabelId, bulkLabelId }, id, scannedIds);
    await saveScannedIds(scannedIds);
    await sleep(THROTTLE_MS);
  }

  await chrome.storage.local.set({ lastScanAt: Date.now() });
}

self.PhishCatchMonitor = {
  POLL_ALARM_NAME,
  connect,
  disconnect,
  resumeIfConnected,
  getStatus,
  runPollCycle,
};
