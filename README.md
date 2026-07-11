# PhishCatch

AI-powered email phishing detector. Paste an email into the web app, or install the Chrome extension to
get an automatic risk score every time you open an email in Gmail.

Works as a **Chrome extension** (auto-scans Gmail) and as a **web app** (manual analysis, built with
Next.js + Tailwind CSS).

---

## How It Works

```
Chrome Extension ──┐
                    ├──▶ Next.js API (/api/analyze) ──▶ Anthropic Claude
Web App ───────────┘
```

1. Email data (subject, sender, body, links) is sanitized and validated on the server
2. Claude evaluates 10 phishing indicators and returns a structured risk score
3. The client renders a verdict — **SAFE / SUSPICIOUS / DANGEROUS** — with an indicator breakdown
4. Scan history is kept locally (browser `localStorage` for the web app, `chrome.storage.local` for the
   extension) — no server-side database, nothing about your scans leaves your machine except the single
   analysis request

## Security

This isn't a toy demo — the API is built to withstand real internet traffic:

- **Input validation & sanitization** — all fields are length-capped, HTML/control characters are
  stripped before anything reaches the LLM prompt, and untrusted email content is explicitly delimited
  and never treated as instructions (prompt-injection resistant)
- **Strict output validation** — the model's JSON response is parsed and validated against a schema
  (`zod`); a malformed or manipulated response can never crash the API or return garbage to a client, and
  score/verdict are always normalized to stay consistent
- **Rate limiting** — per-IP sliding-window limiter on `/api/analyze` (defaults: 20 requests/minute,
  configurable)
- **CORS allow-list** — no wildcard `Access-Control-Allow-Origin`; only origins you explicitly configure
  (e.g. your extension's `chrome-extension://` origin) can call the API cross-origin
- **Timeouts & retries** — upstream Claude calls are bounded by a hard timeout with capped, backed-off
  retries so a slow/failing upstream never hangs a request indefinitely
- **Security headers** — CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  restrictive `Permissions-Policy`
- **No secret leakage** — upstream/auth errors are logged server-side but never surfaced to the client
- **Extension hardening** — a `content_security_policy` locks down extension pages, all rendered scan
  data is HTML-escaped (React auto-escapes in the web app; the extension escapes manually), and
  DOM event handlers use `addEventListener` instead of inline `onclick` so the Gmail banner keeps working
  even under a strict host-page CSP

## Project Structure

```
backend/                        # Next.js app — API + web frontend
├── app/
│   ├── page.tsx                # Renders the web app
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── analyze/route.ts    # POST /api/analyze
│       └── health/route.ts     # GET /api/health
├── components/                 # React UI components (analyzer form, result card, etc.)
└── lib/                        # env, cors, rate limiting, sanitization, schemas, Claude client

extension/                      # Chrome Extension (Manifest V3)
├── manifest.json
├── popup.html
├── scripts/
│   ├── background.js           # API calls + local history + settings
│   ├── content.js               # Gmail scraping + auto-scan banner
│   └── popup.js                 # Dashboard + settings UI
└── styles/
    ├── popup.css
    └── content.css
```

## Setup

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)

### Run the app locally

```bash
cd backend
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open `http://localhost:3000` — the web app and API are both served from here.

### Deploy

Deploy `backend/` to [Vercel](https://vercel.com) (or any Node.js host):

```bash
cd backend
vercel deploy
```

Set the following environment variables in your deployment:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated origins allowed to call the API cross-origin (e.g. `chrome-extension://<id>`) |
| `RATE_LIMIT_MAX` | No | Requests per IP per window on `/api/analyze` (default `20`) |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window in ms (default `60000`) |

### Chrome Extension

1. Go to `chrome://extensions/`, enable Developer mode
2. Click **Load unpacked** and select the `extension/` folder
3. Click the PhishCatch icon → gear icon → set the **API Endpoint** to your deployed URL (or edit
   `DEFAULT_API_URL` in `extension/scripts/background.js` before packaging)
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

Errors return `{ "error": "..." }` with an appropriate status code: `400` (invalid input), `429` (rate
limited), `502`/`504` (upstream failure/timeout).

### `GET /api/health`

Returns `{ status, service, uptimeSeconds }`.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| API | Next.js Route Handlers (Node.js runtime), Zod validation |
| LLM | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Extension | Chrome Manifest V3, vanilla JS |
| Storage | Browser-local only (`localStorage` / `chrome.storage.local`) — no server database |

## License

MIT
