// PhishCatch autonomous inbox monitor.
//
// After a one-time Gmail connection (the single user gesture Google's OAuth
// flow requires), this silently scans mail on a schedule with zero further
// interaction:
//   1. A one-time catch-up scan of recent inbox history (~150 messages).
//   2. A recurring poll (chrome.alarms, since MV3 service workers cannot use
//      setInterval reliably) that checks for new mail every few minutes.
//
// Anything the AI scores as DANGEROUS gets the "PhishCatch/Flagged" Gmail
// label applied. The INBOX label is never removed — nothing is archived,
// moved to Spam, or deleted. Flagged mail simply becomes easy to find later.
//
// Loaded via importScripts() in background.js — exposes a global instead of
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

async function bumpFlaggedCount() {
  const { monitorFlaggedCount } = await chrome.storage.local.get(["monitorFlaggedCount"]);
  await chrome.storage.local.set({ monitorFlaggedCount: (monitorFlaggedCount || 0) + 1 });
}

/** Fetches, analyzes, records, and (if dangerous) labels a single message. */
async function processMessage(token, labelId, id, scannedIds) {
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
      await self.PhishCatchGmail.labelMessage(token, id, labelId);
      await bumpFlaggedCount();
    } catch (err) {
      console.error(`PhishCatch: failed to label message ${id}:`, err.message);
    }
  }
}

/** One-time gesture: authorize Gmail access and start protection. */
async function connect() {
  const token = await self.PhishCatchGmail.getAuthToken(true);
  const labelId = await self.PhishCatchGmail.ensureFlagLabel(token);

  await chrome.storage.local.set({
    gmailConnected: true,
    flagLabelId: labelId,
    monitorFlaggedCount: 0,
  });

  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });

  // Run the catch-up scan in the background without blocking the popup —
  // scanning ~150 emails can take a couple of minutes.
  runCatchUpScan(token, labelId).catch((err) => console.error("PhishCatch catch-up scan failed:", err.message));

  return { connected: true };
}

async function disconnect() {
  try {
    const token = await self.PhishCatchGmail.getAuthToken(false);
    if (token) await self.PhishCatchGmail.removeCachedToken(token);
  } catch {
    // Not fatal — we're disconnecting anyway.
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
    "catchUpInProgress",
    "catchUpProgress",
  ]);
  return {
    connected: !!stored.gmailConnected,
    lastScanAt: stored.lastScanAt || null,
    flaggedCount: stored.monitorFlaggedCount || 0,
    catchUpInProgress: !!stored.catchUpInProgress,
    catchUpProgress: stored.catchUpProgress || null,
  };
}

async function runCatchUpScan(token, labelId) {
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
          await processMessage(token, labelId, id, scannedIds);
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

/** Runs on a chrome.alarms schedule — checks for and scans new inbox mail. */
async function runPollCycle() {
  const { gmailConnected, flagLabelId } = await chrome.storage.local.get(["gmailConnected", "flagLabelId"]);
  if (!gmailConnected) return;

  let token;
  try {
    token = await self.PhishCatchGmail.getAuthToken(false);
  } catch (err) {
    console.error("PhishCatch: silent auth failed, monitor paused until reconnect:", err.message);
    return;
  }

  const labelId = flagLabelId || (await self.PhishCatchGmail.ensureFlagLabel(token));
  const scannedIds = await getScannedIds();

  const { ids } = await self.PhishCatchGmail.listInboxMessageIds(token, { maxResults: POLL_BATCH_SIZE });
  const newIds = ids.filter((id) => !scannedIds.has(id));

  for (const id of newIds) {
    await processMessage(token, labelId, id, scannedIds);
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
