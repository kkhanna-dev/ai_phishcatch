# cf_ai_phishcatch

AI-powered email phishing detector built on Cloudflare. Scans emails for phishing indicators using Llama 3.3 via Workers AI and returns a risk score with detailed findings.

Works as a **Chrome extension** that auto-scans Gmail, and as a **web app** for manual analysis.

---

## How It Works

```
Chrome Extension ──┐
                   ├──▶ Cloudflare Worker ──▶ Workers AI (Llama 3.3)
Web UI ────────────┘         │
                        KV (cache) + Durable Object (history)
```

1. Email data (subject, sender, body, links) is sent to the Worker
2. Worker checks KV cache — if miss, calls Llama 3.3 for analysis
3. LLM evaluates 10 phishing indicators and returns a structured score
4. Result is cached in KV (1h) and persisted in a Durable Object
5. Client renders a verdict: SAFE / SUSPICIOUS / DANGEROUS with indicator breakdown

## Cloudflare Components

| Requirement | What's Used |
|---|---|
| LLM | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI |
| Workflow / Coordination | Cloudflare Worker handles routing, validation, caching, and DO writes |
| User Input | Cloudflare Pages web app with chat-style UI |
| Memory / State | KV namespace (result cache) + Durable Object (scan history) |

## Project Structure

```
worker/                        # Cloudflare Worker
├── wrangler.toml
└── src/
    ├── index.ts               # Routes: /api/analyze, /api/history, /api/stats
    ├── analyze.ts             # Llama 3.3 analysis + KV cache
    ├── types.ts
    └── durable-objects/
        └── scan-history.ts    # Persistent scan log (last 100)

pages/
└── index.html                 # Web UI (Cloudflare Pages)

extension/                     # Chrome Extension (Manifest V3)
├── manifest.json
├── popup.html
├── scripts/
│   ├── background.js          # API calls + local history
│   ├── content.js             # Gmail scraping + auto-scan
│   └── popup.js               # Dashboard
└── styles/
    ├── popup.css
    └── content.css
```

## Setup

### Prerequisites

- Cloudflare account (free tier works)
- Node.js 18+
- Wrangler CLI: `npm install -g wrangler` then `wrangler login`

### Deploy the Worker

```bash
cd worker
npm install

# Create the KV namespace, then paste the IDs into wrangler.toml
wrangler kv:namespace create SCAN_CACHE

wrangler deploy
```

Your Worker URL will be printed — something like `https://cf-ai-phishcatch.<subdomain>.workers.dev`.

### Deploy the Web UI

```bash
wrangler pages deploy pages/ --project-name cf-ai-phishcatch-ui
```

Open `pages/index.html` and set the `API_URL` variable to your Worker URL. Locally it defaults to `http://localhost:8787`.

### Run Locally

```bash
cd worker
npm install
wrangler dev
```

Then open `pages/index.html` in a browser — it auto-detects localhost.

### Chrome Extension

1. Go to `chrome://extensions/`, enable Developer mode
2. Click **Load unpacked** and select the `extension/` folder
3. Set `API_URL` in `extension/scripts/background.js` to your Worker URL
4. Open Gmail and open any email — it scans automatically

## API

### `POST /api/analyze`

```json
// Request
{
  "subject": "Urgent: Verify your account",
  "sender": "security@paypa1.com",
  "body": "Click here or your account will be suspended...",
  "links": ["https://paypa1-verify.sketchy.site/login"]
}

// Response
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

Cached responses include `"cached": true`.

### `GET /api/history?limit=50`

Returns recent scans from the Durable Object.

### `GET /api/stats`

Returns `{ total, safe, suspicious, dangerous, avgScore }`.

## License

MIT
