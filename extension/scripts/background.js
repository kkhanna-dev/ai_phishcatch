// Update this to your deployed Cloudflare Worker URL after running `wrangler deploy`
const API_URL = "https://cf-ai-phishcatch.YOUR_SUBDOMAIN.workers.dev";

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_EMAIL") {
    analyzeEmail(message.data).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
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

  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(emailData),
  });

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

  chrome.storage.local.get(["scanHistory"], (stored) => {
    const history = stored.scanHistory || [];
    history.unshift(historyEntry);
    // Keep last 50 scans
    chrome.storage.local.set({ scanHistory: history.slice(0, 50) });
  });

  return result;
}
