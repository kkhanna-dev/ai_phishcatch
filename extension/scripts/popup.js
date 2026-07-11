// PhishCatch Popup Controller

document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.getElementById("scanBtn");
  const statusCard = document.getElementById("statusCard");
  const statusLabel = document.getElementById("statusLabel");
  const statusDesc = document.getElementById("statusDesc");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const closeSettings = document.getElementById("closeSettings");
  const clearHistory = document.getElementById("clearHistory");
  const monitorDot = document.getElementById("monitorDot");
  const monitorTitle = document.getElementById("monitorTitle");
  const monitorDesc = document.getElementById("monitorDesc");
  const connectGmailBtn = document.getElementById("connectGmailBtn");
  const viewFlaggedBtn = document.getElementById("viewFlaggedBtn");
  const catchupProgress = document.getElementById("catchupProgress");
  const catchupFill = document.getElementById("catchupFill");
  const catchupText = document.getElementById("catchupText");

  // Load stats and history
  loadDashboard();
  refreshMonitorStatus();
  setInterval(refreshMonitorStatus, 3000);

  // Gmail Auto-Protection connect button
  connectGmailBtn.addEventListener("click", async () => {
    connectGmailBtn.disabled = true;
    connectGmailBtn.textContent = "Connecting…";
    try {
      const resp = await sendMessage({ type: "CONNECT_GMAIL" });
      if (resp?.error) throw new Error(resp.error);
      await refreshMonitorStatus();
    } catch (err) {
      monitorDesc.textContent = `Connection failed: ${err.message}`;
    } finally {
      connectGmailBtn.disabled = false;
      connectGmailBtn.textContent = "Connect Gmail";
    }
  });

  viewFlaggedBtn.addEventListener("click", () => {
    const query = encodeURIComponent('label:"PhishCatch/Flagged"');
    chrome.tabs.create({ url: `https://mail.google.com/mail/u/0/#search/${query}` });
  });

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });
  }

  async function refreshMonitorStatus() {
    let status;
    try {
      status = await sendMessage({ type: "GET_MONITOR_STATUS" });
    } catch {
      return; // Service worker waking up — ignore transient errors.
    }
    if (!status) return;

    monitorDot.classList.toggle("on", status.connected);

    if (!status.connected) {
      monitorTitle.textContent = "Gmail Auto-Protection: Off";
      monitorDesc.textContent = "Connect once — PhishCatch will silently scan every email from then on.";
      connectGmailBtn.style.display = "block";
      viewFlaggedBtn.style.display = "none";
      catchupProgress.style.display = "none";
      return;
    }

    connectGmailBtn.style.display = "none";
    viewFlaggedBtn.style.display = "block";

    if (status.catchUpInProgress && status.catchUpProgress) {
      const { scanned, total } = status.catchUpProgress;
      const pct = total ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
      catchupProgress.style.display = "flex";
      catchupFill.style.width = `${pct}%`;
      catchupText.textContent = `Scanning inbox… ${scanned}/${total}`;
    } else {
      catchupProgress.style.display = "none";
    }

    monitorTitle.textContent = "Gmail Auto-Protection: On";
    const lastScan = status.lastScanAt ? formatTimeAgo(status.lastScanAt) : "not yet";
    monitorDesc.textContent = `Last checked ${lastScan} · ${status.flaggedCount} flagged`;
  }

  // Scan button
  scanBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("mail.google.com")) {
      showStatus("warning", "Not on Gmail", "Please navigate to Gmail to scan emails");
      return;
    }

    scanBtn.disabled = true;
    scanBtn.classList.add("scanning");
    scanBtn.innerHTML = `<span class="btn-spinner"></span> Scanning...`;

    try {
      // Inject and execute scan
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractEmailFromPage,
      });

      if (!result?.result?.body && !result?.result?.subject) {
        showStatus("warning", "No Email Open", "Open an email in Gmail to scan it");
        return;
      }

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "ANALYZE_EMAIL", data: result.result }, (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (resp?.error) reject(new Error(resp.error));
          else resolve(resp);
        });
      });

      showScanResult(response);
      loadDashboard();
    } catch (err) {
      showStatus("danger", "Scan Failed", err.message);
    } finally {
      scanBtn.disabled = false;
      scanBtn.classList.remove("scanning");
      scanBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Scan Current Email`;
    }
  });

  // Settings
  settingsBtn.addEventListener("click", () => settingsPanel.classList.add("open"));

  closeSettings.addEventListener("click", () => settingsPanel.classList.remove("open"));

  clearHistory.addEventListener("click", () => {
    chrome.storage.local.set({ scanHistory: [] }, () => {
      loadDashboard();
      settingsPanel.classList.remove("open");
    });
  });

  function showStatus(type, label, desc) {
    statusCard.className = `status-card ${type === "warning" ? "warning" : type === "danger" ? "danger" : "active"}`;
    statusLabel.textContent = label;
    statusDesc.textContent = desc;
  }

  function showScanResult(result) {
    const verdict = result.verdict?.toLowerCase() || "safe";
    const type = verdict === "safe" ? "active" : verdict === "suspicious" ? "warning" : "danger";
    showStatus(type, `Score: ${result.score}/100 — ${result.verdict}`, result.summary);
  }

  function loadDashboard() {
    chrome.storage.local.get(["scanHistory"], (stored) => {
      const history = stored.scanHistory || [];

      // Update stats
      document.getElementById("totalScans").textContent = history.length;
      document.getElementById("safeCount").textContent = history.filter((h) => h.verdict === "SAFE").length;
      document.getElementById("suspiciousCount").textContent = history.filter((h) => h.verdict === "SUSPICIOUS").length;
      document.getElementById("dangerousCount").textContent = history.filter((h) => h.verdict === "DANGEROUS").length;

      // Update history list
      const container = document.getElementById("scanHistory");
      if (history.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <p>No emails scanned yet</p>
            <p class="empty-hint">Open an email in Gmail to auto-scan</p>
          </div>`;
        return;
      }

      container.innerHTML = history
        .slice(0, 10)
        .map((item) => {
          const verdict = (item.verdict || "SAFE").toLowerCase();
          const scoreClass = verdict === "safe" ? "score-safe" : verdict === "suspicious" ? "score-suspicious" : "score-dangerous";
          const verdictClass = `verdict-${verdict}`;
          const timeAgo = formatTimeAgo(item.timestamp);

          return `
          <div class="scan-item" data-id="${item.id}">
            <div class="scan-item-score ${scoreClass}">${item.score}</div>
            <div class="scan-item-info">
              <div class="scan-item-subject">${escapeHtml(item.subject || "No subject")}</div>
              <div class="scan-item-meta">${escapeHtml(item.sender || "Unknown")} · ${timeAgo}</div>
            </div>
            <span class="scan-item-verdict ${verdictClass}">${item.verdict}</span>
          </div>`;
        })
        .join("");

      // Click handlers for detail view
      container.querySelectorAll(".scan-item").forEach((el) => {
        el.addEventListener("click", () => {
          const item = history.find((h) => h.id === el.dataset.id);
          if (item) showDetail(item);
        });
      });
    });
  }

  function showDetail(item) {
    const verdict = (item.verdict || "SAFE").toLowerCase();
    const scoreClass = verdict === "safe" ? "score-safe" : verdict === "suspicious" ? "score-suspicious" : "score-dangerous";

    const overlay = document.createElement("div");
    overlay.className = "detail-overlay";
    overlay.innerHTML = `
      <div class="detail-panel">
        <div class="detail-header">
          <div style="flex:1;min-width:0">
            <div class="detail-title">${escapeHtml(item.subject || "No subject")}</div>
            <div class="detail-sender">${escapeHtml(item.sender || "Unknown sender")} · ${formatTimeAgo(item.timestamp)}</div>
          </div>
          <div class="detail-score-big ${scoreClass}">${item.score}</div>
        </div>

        <div class="detail-summary">${escapeHtml(item.summary || "")}</div>

        ${
          item.indicators?.length
            ? `
          <div class="detail-section-title">Indicators Found</div>
          ${item.indicators.map((i) => `
            <div class="indicator-item">
              <span class="indicator-severity sev-${i.severity}">${i.severity}</span>
              <div>
                <strong>${escapeHtml(i.type)}</strong><br>
                ${escapeHtml(i.detail)}
              </div>
            </div>
          `).join("")}
        ` : ""
        }

        ${
          item.recommendations?.length
            ? `
          <div class="detail-section-title">Recommendations</div>
          ${item.recommendations.map((r) => `<div class="recommendation-item">${escapeHtml(r)}</div>`).join("")}
        ` : ""
        }
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
});

// This function gets injected into the Gmail tab
function extractEmailFromPage() {
  const subjectEl = document.querySelector('h2[data-thread-perm-id]') ||
    document.querySelector('.hP') ||
    document.querySelector('[role="heading"][data-thread-perm-id]');
  const subject = subjectEl?.textContent?.trim() || "";

  const senderEl = document.querySelector('.gD') || document.querySelector('[email]');
  const sender = senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || "";
  const senderName = document.querySelector('.gD')?.getAttribute('name') || "";

  const bodyEl = document.querySelector('.a3s.aiL') || document.querySelector('.ii.gt div');
  const body = bodyEl?.innerText?.trim() || "";

  const links = [];
  if (bodyEl) {
    bodyEl.querySelectorAll('a[href]').forEach((a) => {
      if (a.href && !a.href.startsWith('mailto:') && !a.href.includes('mail.google.com')) {
        links.push(a.href);
      }
    });
  }

  return { subject, sender: senderName ? `${senderName} <${sender}>` : sender, body: body.slice(0, 5000), links };
}
