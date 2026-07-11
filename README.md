# PhishCatch

A local, rule-based email phishing detector for Gmail. Connect it once and it silently scans your **entire
inbox in the background** — new mail as it arrives, plus a one-time catch-up of your recent history — and
labels anything dangerous so you can review it later. No opening emails, no clicking a scan button, no
babysitting required.

**No AI. No LLM. No API keys. No per-email cost.** Every email is scored in milliseconds by a deterministic
rule-based engine that runs entirely on your machine (or your own server, for the optional web app) — brand
impersonation, lookalike domains, urgency/credential-harvesting language, suspicious links, and more.

Also works as a **web app** for one-off manual analysis (paste an email in, get a risk score), built with
Next.js + Tailwind CSS.

---

## How It Works

```
Chrome Extension ── Gmail API (read + label mail) ──▶ Local heuristic engine (in the service worker)
 (background monitor,
  no network calls to score an email)

Web App ──────────────────────────────────────────────▶ Next.js API (/api/analyze) ──▶ Local heuristic engine
```

**Autonomous monitoring (the main event):**

1. You connect Gmail **once** — a single OAuth consent screen, required by Google, not PhishCatch
2. PhishCatch does a one-time catch-up scan of your ~150 most recent inbox emails
3. From then on, a background alarm (`chrome.alarms`) checks for new mail every 5 minutes — no tabs, no
   polling loops, no manual scans
4. Every email is scored **instantly and locally** in the extension's service worker — nothing is ever sent
   to a server or a third party just to analyze a message
5. Anything scored **DANGEROUS** gets a `PhishCatch/Flagged` Gmail label applied — the email **stays in
   your Inbox** (never moved to Spam, never archived, never deleted); you can review flagged mail whenever
   you want via the "View Flagged Emails" button in the popup

**Manual scanning (still available, optional):**

1. Click "Scan Current Email" while an email is open in Gmail, or paste an email into the web app
2. The same rule-based engine scores it instantly — **SAFE / SUSPICIOUS / DANGEROUS** — with a full
   indicator breakdown
3. Scan history is kept locally (browser `localStorage` for the web app, `chrome.storage.local` for the
   extension) — no server-side database, nothing about your scans leaves your machine

## Detection Engine

No model, no prompt, no external call — just deterministic checks tuned against real phishing patterns:

- **Brand impersonation & lookalike domains** — homoglyph/leetspeak normalization (`paypa1.com` →
  `paypal.com`) plus Levenshtein-distance matching against ~40 commonly-spoofed brands, with word-boundary
  matching so short brand names (e.g. `x.com`, `ups.com`) don't false-positive on unrelated words
- **Display-name spoofing** — sender display name claims a brand the email address doesn't match
- **Credential-harvesting & urgency language** — phrase libraries for "verify your account", "enter your
  password", "account will be suspended", etc.
- **Scam lure phrases, generic greetings, common misspellings, aggressive subject formatting**
- **Suspicious links** — raw IP hosts, punycode domains, URL shorteners, risky TLDs, and link-domain vs.
  sender-domain mismatches for known brands

Because it's just string/URL analysis, it runs in under a millisecond, works fully offline, and never costs
a cent per email — no rate limits to worry about, no API key to leak, no vendor dependency.

## Security

- **Input validation & sanitization** — all fields are length-capped and HTML/control characters are
  stripped before analysis; sender addresses are parsed carefully so a bracketed `Name <user@domain>` format
  is never mistaken for an HTML tag and mangled
- **Strict output validation** — the API's JSON response is validated against a schema (`zod`) so a bug can
  never crash the API or return malformed data to a client
- **Rate limiting** — per-IP sliding-window limiter on `/api/analyze` (defaults: 60 requests/minute,
  configurable) — mostly a defensive measure now that analysis is free and instant
- **CORS allow-list** — no wildcard `Access-Control-Allow-Origin`; only origins you explicitly configure
  (e.g. your extension's `chrome-extension://` origin) can call the API cross-origin
- **Security headers** — CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  restrictive `Permissions-Policy`
- **Extension hardening** — a strict `content_security_policy` locks down extension pages (only
  `gmail.googleapis.com` / `accounts.google.com` may be contacted, and only for Gmail auth/label
  operations — never to score an email), all rendered scan data is HTML-escaped, and the OAuth token is
  requested with the minimum Gmail scope needed (`gmail.modify`, for reading mail and applying labels)
- **Least-privilege by design** — the extension never moves mail to Spam or deletes anything; flagged mail
  always stays visible in your Inbox with a label you can inspect or remove yourself

## Project Structure

```
backend/                        # Next.js app — API + web frontend (manual/one-off scanning)
├── app/
│   ├── page.tsx                # Renders the web app
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── analyze/route.ts    # POST /api/analyze
│       └── health/route.ts     # GET /api/health
├── components/                 # React UI components (analyzer form, result card, etc.)
└── lib/
    ├── heuristicEngine.ts       # The rule-based scoring engine
    ├── sanitize.ts               # Input sanitization (HTML-safe sender parsing, etc.)
    └── schema.ts, cors.ts, rateLimit.ts, env.ts

extension/                      # Chrome Extension (Manifest V3) — autonomous Gmail monitoring
├── manifest.json
├── popup.html
├── scripts/
│   ├── heuristics.js            # Same scoring engine, ported to plain JS for the service worker
│   ├── gmail.js                  # Gmail API client (auth, labels, message read)
│   ├── monitor.js                 # chrome.alarms-driven background scan loop + catch-up
│   ├── background.js              # Service worker entry point — wires it all together
│   ├── content.js                 # Gmail page scraping for the manual "scan current email" flow
│   └── popup.js                   # Dashboard + Gmail connect UI
└── styles/
    ├── popup.css
    └── content.css
```

## Setup

### Prerequisites

- Node.js 18+
- A Google Cloud OAuth Client ID (only needed for the Gmail auto-monitoring feature — see below)

### Run the web app locally

```bash
cd backend
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000` — the web app and API are both served from here. No API key required; the
analysis engine runs locally in the Node process.

### Deploy the web app

Deploy `backend/` to [Vercel](https://vercel.com) (or any Node.js host):

```bash
cd backend
vercel deploy
```

Set the following environment variables in your deployment:

| Variable | Required | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | Recommended | Comma-separated origins allowed to call the API cross-origin (e.g. `chrome-extension://<id>`) |
| `RATE_LIMIT_MAX` | No | Requests per IP per window on `/api/analyze` (default `60`) |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window in ms (default `60000`) |

### Chrome Extension

1. Go to `chrome://extensions/`, enable Developer mode
2. Click **Load unpacked** and select the `extension/` folder
3. Open Gmail — a scan banner appears automatically when you open an email, and the popup's "Scan Current
   Email" button works with zero setup (fully local, no backend needed)

### Enabling Gmail Auto-Protection (background monitoring)

The manual scan works out of the box. To enable *autonomous* inbox monitoring (auto-scan every new email,
no clicking), you need your own Google OAuth Client ID — this is a one-time setup step required by Google
so the extension can read your Gmail on your behalf:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create a project (or use an
   existing one)
2. **APIs & Services → Library** → enable the **Gmail API**
3. **APIs & Services → OAuth consent screen** → configure it (External or Internal), add your own account
   as a test user if it's in "Testing" publishing status
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Chrome Extension**
   - Item ID: your unpacked extension's ID, shown at `chrome://extensions/` (enable Developer mode to see
     it)
5. Copy the generated Client ID into `extension/manifest.json`:
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/gmail.modify"]
   }
   ```
6. Reload the extension at `chrome://extensions/`, open the popup, click **Connect Gmail**, and approve the
   consent screen. PhishCatch does a one-time catch-up scan, then monitors silently from then on.

## API

### `POST /api/analyze`

```json
// Request
{
  "subject": "Urgent: Verify your account",
  "sender": "PayPal Security <security@paypa1-verify.com>",
  "body": "Click here or your account will be suspended...",
  "links": ["https://paypa1-verify.sketchy.site/login"]
}

// Response
{
  "score": 100,
  "verdict": "DANGEROUS",
  "summary": "Flagged for: Credential Request, Brand Impersonation.",
  "indicators": [
    { "type": "Brand Impersonation", "detail": "Sender domain \"paypa1-verify.com\" references \"paypal.com\" but isn't the real domain", "severity": "high" },
    { "type": "Urgency Tactic", "detail": "Uses pressure language: \"urgent\"", "severity": "medium" },
    { "type": "Suspicious Link", "detail": "Link domain doesn't match the sender's claimed brand", "severity": "high" }
  ],
  "recommendations": ["Do not click any links or reply.", "Report this email as phishing and delete it."]
}
```

Errors return `{ "error": "..." }` with an appropriate status code: `400` (invalid input), `429` (rate
limited), `500` (unexpected server error).

### `GET /api/health`

Returns `{ status, service, uptimeSeconds }`.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| API | Next.js Route Handlers (Node.js runtime), Zod validation |
| Detection engine | Deterministic rule-based scoring — no AI/LLM, no external calls |
| Extension | Chrome Manifest V3, vanilla JS, Gmail API (OAuth via `chrome.identity`) |
| Storage | Browser-local only (`localStorage` / `chrome.storage.local`) — no server database |

## License

MIT
