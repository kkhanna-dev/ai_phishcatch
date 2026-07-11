// PhishCatch background service worker — talks to the PhishCatch API.

// Default API URL. Update after deploying the Next.js backend to Vercel,
// or override at runtime via the extension's Settings panel (stored in
// chrome.storage.local under "apiUrl").
const DEFAULT_API_URL = "https://your-phishcatch-app.vercel.app";
const REQUEST_TIMEOUT_MS = 25000;

async function getApiUrl() {
  try {
    const { apiUrl } = await chrome.storage.local.get(["apiUrl"]);
    const trimmed = (apiUrl || "").trim().replace(/\/+$/, "");
    return trimmed || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_EMAIL") {
    analyzeEmail(message.data)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === "GET_SCAN_HISTORY") {
    chrome.storage.local.get(["scanHistory"], (result) => {
      sendResponse(result.scanHistory || []);
    });
    return true;
  }
});

async function analyzeEmail(emailData) {
  const apiUrl = await getApiUrl();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${apiUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailData),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Analysis timed out. Please try again.");
    }
    throw new Error(
      "Could not reach the PhishCatch API. Check your connection or the API URL in Settings."
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }

  const result = await response.json();

  // Save to history
  const historyEntry = {
    ...result,
    subject: emailData.subject,
    sender: emailData.sender,
    timestamp: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  try {
    const stored = await chrome.storage.local.get(["scanHistory"]);
    const history = stored.scanHistory || [];
    history.unshift(historyEntry);
    // Keep last 50 scans
    await chrome.storage.local.set({ scanHistory: history.slice(0, 50) });
  } catch {
    // Non-fatal — the scan result itself still gets returned to the caller.
  }

  return result;
}
