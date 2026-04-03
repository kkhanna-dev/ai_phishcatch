# cf_ai_phishcatch — AI Email Phishing Detector

> **Note:** Rename this repository to `cf_ai_phishcatch` on GitHub to meet the assignment naming requirement.

<p align="center">
  <img src="extension/icons/icon128.svg" alt="PhishCatch Logo" width="80" />
</p>

<p align="center">
  <strong>AI-powered email phishing detection — Chrome extension + web app + serverless API, all on Cloudflare.</strong>
</p>

---

## What It Does

PhishCatch detects phishing emails using **Llama 3.3 on Cloudflare Workers AI**. It works in two ways:

1. **Chrome Extension** — auto-scans every email you open in Gmail and shows a color-coded risk banner
2. **Web App** — paste any email into the chat interface at the Cloudflare Pages URL for instant analysis

Every scan is cached in **KV** and persisted to a **Durable Object** so history and stats survive across requests.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────┐
│  Chrome         │     │  Cloudflare Workers (cf-ai-phishcatch)        │
│  Extension      │────▶│                                              │
│  (Gmail)        │     │  POST /api/analyze                           │
│                 │◀────│    ├─ KV cache (1h TTL)                      │
└─────────────────┘     │    ├─ Workers AI → Llama 3.3                 │
                        │    └─ Durable Object (scan history)          │
┌─────────────────┐     │                                              │
│  Cloudflare     │     │  GET /api/history                            │
│  Pages          │────▶│  GET /api/stats                              │
│  (Web Chat UI)  │◀────│    └─ Durable Object reads                   │
└─────────────────┘     └──────────────────────────────────────────────┘
```

### Assignment Checklist

| Requirement | Implementation |
|---|---|
| **LLM** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI |
| **Workflow / Coordination** | Cloudflare Worker routes requests; Durable Object coordinates history writes |
| **User Input (chat/voice)** | Cloudflare Pages web app — chat-style email analysis UI |
| **Memory / State** | KV (result cache, 1h TTL) + Durable Object (persistent scan history, last 100) |

---

## Project Structure

```
cf_ai_phishcatch/
├── worker/                        # Cloudflare Worker (API backend)
│   ├── wrangler.toml
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               # Router: /api/analyze, /api/history, /api/stats
│       ├── analyze.ts             # Workers AI Llama 3.3 analysis + KV cache
│       ├── types.ts               # Shared TypeScript interfaces
│       └── durable-objects/
│           └── scan-history.ts    # Durable Object — persistent scan log
│
├── pages/
│   └── index.html                 # Cloudflare Pages web UI (chat interface)
│
├── extension/                     # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html
│   ├── scripts/
│   │   ├── background.js          # Service worker — calls Worker API
│   │   ├── content.js             # Gmail DOM scraping + auto-scan
│   │   └── popup.js               # Dashboard controller
│   └── styles/
│       ├── popup.css
│       └── content.css
│
└── backend/                       # Legacy Next.js backend (Vercel) — superseded by worker/
```

---

## Setup & Running

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Node.js 18+
- `npm install -g wrangler` then `wrangler login`

---

### 1. Deploy the Cloudflare Worker

```bash
cd worker
npm install

# Create a KV namespace for caching
wrangler kv:namespace create SCAN_CACHE
# → Copy the returned id and preview_id into wrangler.toml

wrangler deploy
# → Your Worker URL: https://cf-ai-phishcatch.<subdomain>.workers.dev
```

The Worker automatically provisions the Durable Object (`ScanHistory`) on first deploy.

---

### 2. Deploy the Web UI (Cloudflare Pages)

Option A — Cloudflare Dashboard:
1. Go to **Workers & Pages → Create application → Pages → Upload assets**
2. Upload the `pages/` folder
3. Done — you get a `*.pages.dev` URL

Option B — Wrangler CLI:
```bash
wrangler pages deploy pages/ --project-name cf-ai-phishcatch-ui
```

Then update `pages/index.html` line 4 of the `<script>` section to set your Worker URL:
```js
: "https://cf-ai-phishcatch.YOUR_SUBDOMAIN.workers.dev";
```

---

### 3. Run Locally

```bash
cd worker
npm install
wrangler dev          # API on http://localhost:8787
```

Open `pages/index.html` directly in your browser — it auto-detects `localhost` and points to `http://localhost:8787`.

---

### 4. Load the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Edit `extension/scripts/background.js` and set `API_URL` to your deployed Worker URL
5. Open Gmail and open any email — it scans automatically

---

## API Reference

### `POST /api/analyze`

Analyzes an email for phishing indicators using Llama 3.3.

**Request:**
```json
{
  "subject": "Urgent: Verify your account",
  "sender": "security@paypa1.com",
  "body": "Click here or your account will be suspended...",
  "links": ["https://paypa1-verify.sketchy.site/login"]
}
```

**Response:**
```json
{
  "score": 94,
  "verdict": "DANGEROUS",
  "summary": "High-confidence phishing: spoofed domain, urgency tactic, and deceptive URL.",
  "indicators": [
    { "type": "Spoofed Domain", "detail": "paypa1.com mimics paypal.com", "severity": "high" },
    { "type": "Urgency Tactic", "detail": "Threatens account suspension", "severity": "high" }
  ],
  "recommendations": ["Do not click links", "Report as phishing in Gmail"]
}
```

Results are cached in KV for 1 hour. Cached responses include `"cached": true`.

### `GET /api/history?limit=50`

Returns the last N scans from the Durable Object.

### `GET /api/stats`

Returns aggregate counts: `{ total, safe, suspicious, dangerous, avgScore }`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **LLM** | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) via Cloudflare Workers AI |
| **API** | Cloudflare Workers (TypeScript) |
| **Memory / State** | Cloudflare KV (cache) + Durable Objects (history) |
| **Web UI** | Cloudflare Pages (vanilla HTML/CSS/JS) |
| **Extension** | Chrome Manifest V3, vanilla JS |

---

## License

MIT
