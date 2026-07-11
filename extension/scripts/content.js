// PhishCatch - Gmail Content Script
// Scans emails automatically when opened in Gmail

(function () {
  "use strict";

  const SCAN_DEBOUNCE_MS = 1500;
  let lastScannedUrl = "";
  let scanTimeout = null;
  let isScanning = false;

  // Watch for Gmail navigation (email open/close)
  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastScannedUrl && isEmailView(currentUrl)) {
      clearTimeout(scanTimeout);
      scanTimeout = setTimeout(() => {
        lastScannedUrl = currentUrl;
        scanCurrentEmail();
      }, SCAN_DEBOUNCE_MS);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function isEmailView(url) {
    // Gmail email view URLs contain a message ID hash
    return /mail\.google\.com\/mail\/.*#[^/]+\/[a-zA-Z0-9]+/.test(url);
  }

  function extractEmailData() {
    // Extract subject
    const subjectEl = document.querySelector('h2[data-thread-perm-id]') ||
      document.querySelector('.hP') ||
      document.querySelector('[role="heading"][data-thread-perm-id]');
    const subject = subjectEl?.textContent?.trim() || "";

    // Extract sender
    const senderEl = document.querySelector('.gD') ||
      document.querySelector('[email]') ||
      document.querySelector('.go');
    const sender = senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || "";
    const senderName = document.querySelector('.gD')?.getAttribute('name') || "";

    // Extract email body
    const bodyEl = document.querySelector('.a3s.aiL') ||
      document.querySelector('.ii.gt div') ||
      document.querySelector('[role="list"] .a3s');
    const body = bodyEl?.innerText?.trim() || "";

    // Extract links
    const links = [];
    if (bodyEl) {
      bodyEl.querySelectorAll('a[href]').forEach((a) => {
        const href = a.href;
        if (href && !href.startsWith('mailto:') && !href.includes('mail.google.com')) {
          links.push(href);
        }
      });
    }

    return { subject, sender: senderName ? `${senderName} <${sender}>` : sender, body: body.slice(0, 5000), links };
  }

  async function scanCurrentEmail() {
    if (isScanning) return;

    const emailData = extractEmailData();
    if (!emailData.body && !emailData.subject) return;

    isScanning = true;
    showBanner("scanning");

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "ANALYZE_EMAIL", data: emailData }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });

      showBanner(result.verdict?.toLowerCase(), result);
    } catch (err) {
      console.error("PhishCatch scan error:", err);
      showBanner("error", { summary: err.message });
    } finally {
      isScanning = false;
    }
  }

  function showBanner(status, result) {
    // Remove existing banner
    const existing = document.getElementById("phishcatch-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "phishcatch-banner";
    banner.className = `phishcatch-banner phishcatch-${status}`;

    if (status === "scanning") {
      banner.innerHTML = `
        <div class="phishcatch-banner-content">
          <div class="phishcatch-spinner"></div>
          <span class="phishcatch-banner-text">
            <strong>PhishCatch</strong>: Scanning email for phishing threats...
          </span>
        </div>
      `;
    } else if (status === "error") {
      banner.innerHTML = `
        <div class="phishcatch-banner-content">
          <span class="phishcatch-icon">⚠️</span>
          <span class="phishcatch-banner-text">
            <strong>PhishCatch</strong>: Could not scan: ${escapeHtml(result?.summary || "Unknown error")}
          </span>
          <button class="phishcatch-dismiss" type="button">✕</button>
        </div>
      `;
    } else {
      const icon = status === "safe" ? "✅" : status === "suspicious" ? "⚠️" : "🚨";
      const scoreColor = getScoreColor(result.score);
      const indicatorHtml = (result.indicators || [])
        .filter(i => i.severity === "high" || i.severity === "medium")
        .slice(0, 3)
        .map(i => `<span class="phishcatch-indicator phishcatch-sev-${i.severity}">${escapeHtml(i.detail)}</span>`)
        .join("");

      banner.innerHTML = `
        <div class="phishcatch-banner-content">
          <span class="phishcatch-icon">${icon}</span>
          <div class="phishcatch-score-ring" style="--score-color: ${scoreColor}; --score-pct: ${result.score}%">
            <span class="phishcatch-score-num">${result.score}</span>
          </div>
          <div class="phishcatch-banner-info">
            <span class="phishcatch-banner-text">
              <strong>PhishCatch</strong>: ${escapeHtml(result.summary || result.verdict)}
            </span>
            ${indicatorHtml ? `<div class="phishcatch-indicators">${indicatorHtml}</div>` : ""}
          </div>
          <button class="phishcatch-dismiss" type="button">✕</button>
        </div>
      `;
    }

    // Insert at top of email view
    const emailContainer = document.querySelector('.nH.bkK') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.nH');
    if (emailContainer) {
      emailContainer.insertBefore(banner, emailContainer.firstChild);
    }

    // Attach the dismiss handler via addEventListener rather than an inline
    // onclick attribute, so the banner still works under a strict host-page CSP.
    const dismissBtn = banner.querySelector(".phishcatch-dismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", () => banner.remove());
    }
  }

  function getScoreColor(score) {
    if (score <= 25) return "#10b981";
    if (score <= 50) return "#f59e0b";
    if (score <= 75) return "#f97316";
    return "#ef4444";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
