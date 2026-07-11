# PhishCatch

A local, rule-based email phishing detector for Gmail. Connect it once and it scans your entire inbox in
the background: new mail as it arrives, plus a one-time catch-up of your recent history. Anything that
looks dangerous gets flagged for you to review later. You don't need to open emails, click a scan button,
or babysit it.

No AI, no LLM, no API keys, and no per-email cost. Every message is scored in milliseconds by a
deterministic rule-based engine that runs entirely on your machine (or your own server, for the web app).
It checks for brand impersonation, lookalike domains, urgency and credential-harvesting language,
suspicious links, and a handful of other patterns real phishing emails tend to share.

There's also a web app for one-off manual analysis. Paste an email in, get a risk score back. Built with
Next.js and Tailwind CSS.

---

## How it works

```
Chrome Extension --- Gmail API (read + label mail) ---> Local heuristic engine (in the service worker)
 (background monitor, no network calls to score an email)

Web App -----------------------------------------------> Next.js API (/api/analyze) ---> Local heuristic engine
```

Autonomous monitoring, the main feature:

1. You connect Gmail once. It's a single OAuth consent screen, required by Google, not something
   PhishCatch adds on its own.
2. PhishCatch does a one-time catch-up scan of your ~150 most recent inbox emails.
3. From then on, a background alarm (`chrome.alarms`) checks for new mail every 5 minutes. No open tabs,
   no polling loops, no manual scans needed.
4. Every email is scored instantly and locally in the extension's service worker. Nothing gets sent to a
   server or a third party just to analyze a message.
5. Anything scored DANGEROUS gets a `PhishCatch/Flagged` Gmail label. The email stays in your inbox (it's
   never moved to Spam, archived, or deleted), and you can review flagged mail whenever you want using the
   "View Flagged Emails" button in the popup.

Manual scanning, still available if you want it:

1. Click "Scan Current Email" while an email is open in Gmail, or paste an email into the web app.
2. The same rule-based engine scores it instantly: SAFE, SUSPICIOUS, or DANGEROUS, with a full breakdown
   of what triggered the score.
3. Scan history is kept locally (`localStorage` for the web app, `chrome.storage.local` for the extension).
   There's no server-side database, and nothing about your scans leaves your machine.

## Detection engine

No model, no prompt, no external call. Just string and URL checks tuned against real phishing patterns:

- Brand impersonation and lookalike domains. Homoglyph and leetspeak normalization catches tricks like
  `paypa1.com` for `paypal.com`, plus Levenshtein-distance matching against roughly 40 commonly-spoofed
  brands. Word-boundary matching keeps short brand names (`x.com`, `ups.com`) from false-positiving on
  unrelated words.
- Display-name spoofing, where the sender's display name claims a brand but the actual address doesn't
  match.
- Credential-harvesting and urgency language: phrases like "verify your account," "enter your password,"
  "account will be suspended."
- Scam lure phrases, generic greetings, common misspellings, aggressive subject-line formatting.
- Suspicious links: raw IP hosts, punycode domains, URL shorteners, risky TLDs, and cases where a link's
  domain doesn't match what the sender claims to be.

It's just string and URL analysis, so it runs in under a millisecond, works fully offline, and doesn't
cost anything per email. No rate limits to think about, no API key to leak, no vendor to depend on.

## Security

- Input validation and sanitization. All fields are length-capped and HTML/control characters get
  stripped before analysis. Sender addresses are parsed carefully so a bracketed `Name <user@domain>`
  format doesn't get mistaken for an HTML tag and mangled.
- Strict output validation. The API's JSON response is validated against a schema (zod), so a bug can't
  crash the API or send malformed data back to a client.
- Rate limiting: a per-IP sliding-window limiter on `/api/analyze` (default 60 requests/minute,
  configurable). Mostly a defensive measure now that analysis is free and instant.
- CORS allow-list. No wildcard `Access-Control-Allow-Origin`; only origins you explicitly configure (like
  your extension's `chrome-extension://` origin) can call the API cross-origin.
- Security headers: CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a restrictive
  `Permissions-Policy`.
- Extension hardening. A strict `content_security_policy` locks down extension pages so only
  `gmail.googleapis.com` and `accounts.google.com` can be contacted, and only for Gmail auth/label
  operations, never to score an email. All rendered scan data is HTML-escaped. The OAuth token requests
  the minimum Gmail scope needed (`gmail.modify`, for reading mail and applying labels).
- Least-privilege by design. The extension never moves mail to Spam or deletes anything. Flagged mail
  always stays visible in your inbox with a label you can inspect or remove yourself.

## Project structure

```
backend/                        # Next.js app: API + web frontend (manual/one-off scanning)
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

extension/                      # Chrome Extension (Manifest V3), autonomous Gmail monitoring
├── manifest.json
├── popup.html
├── scripts/
│   ├── heuristics.js            # Same scoring engine, ported to plain JS for the service worker
│   ├── gmail.js                  # Gmail API client (auth, labels, message read)
│   ├── monitor.js                 # chrome.alarms-driven background scan loop + catch-up
│   ├── background.js              # Service worker entry point, wires it all together
│   ├── content.js                 # Gmail page scraping for the manual "scan current email" flow
│   └── popup.js                   # Dashboard + Gmail connect UI
└── styles/
    ├── popup.css
    └── content.css
```

## Setup

### Prerequisites

- Node.js 18+
- A Google Cloud OAuth Client ID (only needed for the Gmail auto-monitoring feature, see below)

### Run the web app locally

```bash
cd backend
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The web app and API are both served from here. No API key required; the
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

### Chrome extension

1. Go to `chrome://extensions/` and enable Developer mode.
2. Click **Load unpacked** and select the `extension/` folder.
3. Open Gmail. A scan banner appears automatically when you open an email, and the popup's "Scan Current
   Email" button works with zero setup since it's fully local, no backend needed.

### Enabling Gmail Auto-Protection (background monitoring)

The manual scan works out of the box. To enable autonomous inbox monitoring (auto-scan every new email,
no clicking), you need your own Google OAuth Client ID. This is a one-time setup step required by Google
so the extension can read your Gmail on your behalf:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or use an
   existing one).
2. Under **APIs & Services > Library**, enable the **Gmail API**.
3. Under **APIs & Services > OAuth consent screen**, configure it (External or Internal), and add your
   own account as a test user if it's in "Testing" publishing status.
4. Under **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: Chrome Extension
   - Item ID: your unpacked extension's ID, shown at `chrome://extensions/` (enable Developer mode to see
     it)
5. Copy the generated Client ID into `extension/manifest.json`:
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/gmail.modify"]
   }
   ```
6. Reload the extension at `chrome://extensions/`, open the popup, click **Connect Gmail**, and approve
   the consent screen. PhishCatch does a one-time catch-up scan, then monitors silently after that.

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

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| API | Next.js Route Handlers (Node.js runtime), Zod validation |
| Detection engine | Deterministic rule-based scoring, no AI/LLM, no external calls |
| Extension | Chrome Manifest V3, vanilla JS, Gmail API (OAuth via `chrome.identity`) |
| Storage | Browser-local only (`localStorage` / `chrome.storage.local`), no server database |

## License

MIT
