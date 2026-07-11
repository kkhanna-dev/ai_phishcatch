// PhishCatch background service worker.
//
// Wires together:
//   - heuristics.js: 100% local, rule-based phishing scoring engine (no
//     network calls, no API costs, works offline)
//   - gmail.js:      Gmail API client (auth, labels, message read/modify)
//   - bulk.js:       local bulk/promotional mail classifier (declutter, not
//     security), independent of the phishing scorer
//   - monitor.js:    autonomous inbox scanning engine (chrome.alarms driven)
//
// Manual scans (from the popup's "Scan Current Email" button or the Gmail
// content script) run the exact same local analysis as the autonomous
// monitor. There is no backend dependency for scanning at all.
importScripts("heuristics.js", "gmail.js", "bulk.js", "monitor.js");

const MAX_HISTORY = 50;

async function addToHistory(entry) {
  try {
    const stored = await chrome.storage.local.get(["scanHistory"]);
    const history = stored.scanHistory || [];
    history.unshift(entry);
    await chrome.storage.local.set({ scanHistory: history.slice(0, MAX_HISTORY) });
  } catch {
    // Non-fatal, the caller still has the analysis result.
  }
}
self.PhishCatchHistory = { addToHistory };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_EMAIL") {
    handleManualAnalyze(message.data)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep the message channel open for the async response.
  }

  if (message.type === "GET_SCAN_HISTORY") {
    chrome.storage.local.get(["scanHistory"], (result) => sendResponse(result.scanHistory || []));
    return true;
  }

  if (message.type === "CONNECT_GMAIL") {
    self.PhishCatchMonitor.connect()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "DISCONNECT_GMAIL") {
    self.PhishCatchMonitor.disconnect()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "GET_MONITOR_STATUS") {
    self.PhishCatchMonitor.getStatus().then(sendResponse);
    return true;
  }
});

async function handleManualAnalyze(emailData) {
  const result = self.PhishCatchHeuristics.analyze(emailData);
  await addToHistory({
    ...result,
    subject: emailData.subject,
    sender: emailData.sender,
    timestamp: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: "manual",
  });
  return result;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === self.PhishCatchMonitor.POLL_ALARM_NAME) {
    self.PhishCatchMonitor.runPollCycle().catch((err) => console.error("PhishCatch poll error:", err.message));
  }
});

// If the browser restarts or the (non-persistent) service worker wakes up
// after having been connected previously, resume monitoring automatically.
// No user action is needed beyond the original one-time connect.
chrome.runtime.onStartup.addListener(() => self.PhishCatchMonitor.resumeIfConnected());
chrome.runtime.onInstalled.addListener(() => self.PhishCatchMonitor.resumeIfConnected());
