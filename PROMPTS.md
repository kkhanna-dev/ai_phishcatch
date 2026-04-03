# AI Prompts Used to Build cf_ai_phishcatch

This document records every prompt given to Claude Code (Anthropic) during the development of this project, as well as the runtime LLM prompts embedded in application code.

**AI Tool Used:** Claude Code (CLI) — models `claude-sonnet-4-6` and `claude-opus-4-6`

---

## Phase 1 — Initial Project Scaffolding & Chrome Extension

### Prompt 1: Project bootstrap and architecture

```
I want to build an AI-powered email phishing detection tool called "PhishCatch". It should have two parts:

1. A Chrome Extension (Manifest V3) that integrates with Gmail. When a user opens an email in Gmail,
   the extension should automatically:
   - Detect that the user navigated to an email view (using a MutationObserver on URL changes)
   - Extract the email subject, sender name + email address, full body text, and all links from the email DOM
   - Send this data to a backend API for analysis
   - Display the results as a color-coded banner injected at the top of the email view inside Gmail

2. A Next.js 14 (App Router) backend deployed on Vercel with a single POST endpoint at /api/analyze
   that takes the email data, sends it to the Anthropic Claude API (claude-sonnet-4-20250514), and returns
   a structured phishing analysis.

For the extension specifically:
- Use a content script that runs on mail.google.com/* to scrape email data from Gmail's DOM.
  Gmail uses classes like .hP for subject, .gD for sender, .a3s.aiL for body. Use those selectors
  with fallbacks.
- Debounce scans by 1500ms so we don't fire on every DOM mutation while Gmail loads.
- Extract all <a href> links from the email body, excluding mailto: and mail.google.com links.
- Truncate the body to 5000 chars to stay within token limits.
- The content script should call chrome.runtime.sendMessage to hand off to a background service worker,
  which makes the actual fetch() to the API. This avoids CORS issues from the content script.
- Store scan history in chrome.storage.local (last 50 scans) with subject, sender, score, verdict,
  and timestamp.
- Build a popup.html dashboard that shows: total scans, safe/suspicious/dangerous counts in a stats grid,
  and a scrollable scan history list with expandable detail modals showing full indicators and recommendations.

For the phishing analysis prompt to Claude:
- Evaluate 10 specific phishing indicators: sender spoofing, urgency/pressure tactics, suspicious links,
  grammar errors, credential requests, brand impersonation, too-good-to-be-true offers, mismatched reply-to,
  generic greetings, and attachment/download requests.
- Return ONLY valid JSON with: score (0-100), verdict (SAFE/SUSPICIOUS/DANGEROUS), summary (one sentence),
  indicators array (type, detail, severity), and recommendations array.
- The scoring should map: 0-30 = SAFE, 31-65 = SUSPICIOUS, 66-100 = DANGEROUS.

For the banner UI in Gmail:
- Show a scanning state with a CSS spinner while waiting for the API
- Show an error state if the API fails
- For results: show an emoji icon (green check / warning / red siren), a circular score ring with
  percentage fill using CSS custom properties, the summary text, and up to 3 medium/high severity
  indicators as inline badges
- Include a dismiss button (X) on each banner
- Style it so it doesn't clash with Gmail's UI — use a fixed-width banner with rounded corners,
  subtle shadows, and the score ring should use color gradients: green <= 25, amber <= 50, orange <= 75, red > 75

Set up the project structure as:
- extension/ folder with manifest.json, popup.html, scripts/ (background.js, content.js, popup.js),
  styles/ (content.css, popup.css), and icons/
- backend/ folder as a Next.js project with app/api/analyze/route.ts and app/api/health/route.ts
- Include proper CORS headers (Access-Control-Allow-Origin: *) on the API since the extension
  calls it cross-origin
```

### Prompt 2: Extension popup dashboard polish

```
The popup dashboard needs more work. Update popup.html and popup.js:

- The popup should be exactly 380px wide with a clean dark theme (background #1a1d27, text #e2e4f0,
  accent #6366f1).
- Stats grid at the top: 4 cards showing Total Scans, Safe (green), Suspicious (amber), Dangerous (red)
  with large numbers and small labels.
- Below that, a scrollable scan history list. Each item shows: a colored score number on the left,
  subject line (truncated with ellipsis), sender + relative timestamp ("2m ago", "1h ago"), and a
  verdict badge on the right.
- Clicking a history item opens an inline detail view (not a new page) that expands to show: full subject,
  sender, score with the color ring, summary text, all indicators with severity dots (red/amber/green),
  and the full recommendations list.
- Add a "Rescan" button in the detail view that re-sends the email data to the API.
- The popup should load history from chrome.storage.local on open and update in real time if a scan
  completes while the popup is open.

Also add a settings panel (gear icon in the header) that lets the user configure a custom API endpoint
URL, saved to chrome.storage.local. The background.js should read this setting and use it instead of
the hardcoded URL if set.
```

### Prompt 3: Extension icons generation

```
I need PNG icons for the Chrome extension at 16x16, 48x48, and 128x128 sizes. Create SVG source files
for each (a shield icon with a checkmark that represents phishing protection — use indigo #6366f1 as the
primary color). Also create a generate-icons.html helper page that renders the SVGs on canvases and lets
me download the PNGs, since Chrome requires PNG format for manifest icons.
```

---

## Phase 2 — Migration to Cloudflare Platform

### Prompt 4: Cloudflare Worker backend with Workers AI

```
I need to migrate the entire backend from Next.js/Vercel to Cloudflare. Replace the Anthropic Claude API
with Cloudflare Workers AI using the Llama 3.3 70B model (@cf/meta/llama-3.3-70b-instruct-fp8-fast).

Create a new worker/ directory with a complete Cloudflare Worker project:

1. wrangler.toml — configure:
   - Workers AI binding (AI)
   - KV namespace binding (SCAN_CACHE) for caching analysis results with a 1-hour TTL
   - Durable Object binding (SCAN_HISTORY) with the ScanHistory class for persistent scan history
   - Include the migration tag for the Durable Object

2. TypeScript source in worker/src/:
   - types.ts — define interfaces for Env (with AI, KV, and DO bindings), EmailInput, AnalysisResult,
     PhishingIndicator, and ScanHistoryEntry
   - index.ts — main fetch handler that routes:
     - POST /api/analyze → email analysis
     - GET /api/history?limit=N → scan history from Durable Object
     - GET /api/stats → aggregate statistics from Durable Object
     - GET / → JSON health check with endpoint documentation
     - OPTIONS on any path → CORS preflight
   - analyze.ts — the core analysis logic:
     - Parse and validate the incoming email JSON
     - Build a deterministic cache key from subject + sender + body prefix using a simple hash
     - Check KV cache first; if hit, return with a "cached: true" flag
     - If cache miss, call Workers AI with a carefully engineered system prompt that instructs
       Llama 3.3 to return valid JSON matching our AnalysisResult schema
     - Extract JSON from the response (handle cases where the model wraps it in markdown code blocks)
     - Normalize score/verdict consistency (enforce the 0-30/31-65/66-100 ranges)
     - Write to KV cache with 1-hour expiration
     - POST the result to the Durable Object's /add endpoint to persist in history
   - durable-objects/scan-history.ts — a Durable Object class that:
     - Stores scan history in transactional storage (max 100 entries, newest first)
     - GET /history — returns history array with optional limit param
     - POST /add — prepends a new entry and trims to max length
     - GET /stats — computes and returns total/safe/suspicious/dangerous counts and average score
     - DELETE /clear — wipes the history

   The system prompt for Llama 3.3 should be tightly constrained to force JSON-only output:
   tell it to respond ONLY with valid JSON, give it the exact schema, provide scoring guidance
   for the three verdict tiers, and list all 10 phishing indicators to evaluate. This is critical
   because Llama 3.3 is more likely than Claude to add conversational text around the JSON.

3. package.json with wrangler, @cloudflare/workers-types, and typescript as devDependencies
4. tsconfig.json targeting ES2022 with bundler module resolution and @cloudflare/workers-types

Make sure all API responses include Access-Control-Allow-Origin: * headers since both the Chrome
extension and the Pages frontend will call this cross-origin.
```

### Prompt 5: Cloudflare Pages web chat UI

```
Create a Cloudflare Pages web app in a pages/ directory with a single index.html file that provides
a chat-style interface for analyzing emails. This fulfills the "user input via chat" requirement.

Design requirements:
- Dark theme matching the extension (bg #0f1117, surface #1a1d27, border #2d3048, accent #6366f1)
- Two-column layout on desktop (stacked on mobile):
  - Left panel: "Analyze Email" form with inputs for Subject, Sender, Email Body (textarea),
    and a link adder (text input + "+" button that adds URL tags below, with X to remove each)
  - Right panel: tabbed view with "Results" and "History" tabs

- Results tab:
  - Starts with an empty state (magnifying glass icon + instructional text)
  - When the user submits: show a user bubble with the subject/sender, then a thinking bubble
    with a CSS spinner saying "Analyzing with Llama 3.3 on Cloudflare Workers AI..."
  - When results arrive: replace the thinking bubble with a result card showing:
    verdict badge (color-coded), score in a circular ring, summary text, indicator list
    with severity dots (red/amber/green), and recommendations as a bulleted list
  - If the result was cached, show a small "Cached result" note

- History tab:
  - Loads from GET /api/history and GET /api/stats on tab switch
  - Shows a 2x2 stats grid (Total, Safe, Suspicious, Dangerous) at the top
  - Below: scrollable list of past scans showing score, subject, sender, timestamp, verdict badge
  - Clicking a history item switches to the Results tab and renders that scan's full details

- The API URL should auto-detect: use localhost:8787 when running locally (for wrangler dev),
  otherwise use the deployed Worker URL (user replaces a placeholder constant)

- All vanilla HTML/CSS/JS — no build step, no frameworks. This is a static site for Cloudflare Pages.
- Escape all user-generated content to prevent XSS when rendering results.
```

### Prompt 6: Update extension for new backend

```
Update extension/scripts/background.js to point API_URL to the new Cloudflare Worker URL instead of
the old Vercel URL. Use a placeholder format like https://cf-ai-phishcatch.YOUR_SUBDOMAIN.workers.dev
with a comment telling the developer to update it after running wrangler deploy.
```

### Prompt 7: README documentation

```
Rewrite README.md completely for the Cloudflare-based architecture. Include:

- Project title as "cf_ai_phishcatch" with a note to rename the GitHub repo
- One-paragraph description of what it does and that it runs on Cloudflare Workers AI with Llama 3.3
- ASCII architecture diagram showing the data flow: Chrome Extension and Pages UI both call the
  Cloudflare Worker, which uses Workers AI, KV, and Durable Objects
- An assignment checklist table mapping each requirement (LLM, Workflow, User Input, Memory) to
  the specific implementation
- Full project structure tree
- Step-by-step setup instructions for:
  1. Deploying the Worker (npm install, create KV namespace, wrangler deploy)
  2. Deploying the Pages UI (dashboard upload or wrangler pages deploy)
  3. Running locally with wrangler dev (note that Pages auto-detects localhost)
  4. Loading the Chrome extension in developer mode
- API reference with request/response examples for all three endpoints
- Tech stack table
```

---

## Phase 3 — Runtime LLM Prompts (Embedded in Application Code)

### Workers AI System Prompt (Llama 3.3)

**File:** `worker/src/analyze.ts` — `SYSTEM_PROMPT` constant
**Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

```
You are an expert email security analyst specializing in phishing detection.
Analyze emails for phishing indicators and respond ONLY with valid JSON matching this exact schema:
{
  "score": <integer 0-100, where 0=safe and 100=definite phishing>,
  "verdict": "<SAFE|SUSPICIOUS|DANGEROUS>",
  "summary": "<one sentence summary of findings>",
  "indicators": [
    {"type": "<category>", "detail": "<specific finding>", "severity": "<low|medium|high>"}
  ],
  "recommendations": ["<actionable recommendation>"]
}

Scoring guidance: 0-30 = SAFE, 31-65 = SUSPICIOUS, 66-100 = DANGEROUS.
Evaluate: sender spoofing, urgency/pressure tactics, suspicious URLs, grammar errors,
requests for credentials/PII, brand impersonation, too-good-to-be-true offers,
generic greetings, mismatched reply-to, attachment/download requests.
```

### Workers AI User Prompt (constructed per request)

```
Analyze this email for phishing:

Subject: {subject}
From: {sender}
Links: {links joined by comma}

{body, truncated to 6000 chars}
```

### Legacy Claude API Prompt (original Vercel backend)

**File:** `backend/app/api/analyze/route.ts`
**Model:** `claude-sonnet-4-20250514`

```
You are an expert email security analyst. Analyze this email for phishing indicators
and return a JSON response.

Evaluate these factors:
1. Sender legitimacy (spoofed domains, free email providers impersonating companies)
2. Urgency/pressure tactics ("act now", "account suspended", "verify immediately")
3. Suspicious links (mismatched display text vs URL, URL shorteners, lookalike domains)
4. Grammar and spelling errors typical of phishing
5. Requests for sensitive info (passwords, SSN, credit cards, login credentials)
6. Impersonation of known brands or authority figures
7. Too-good-to-be-true offers
8. Mismatched reply-to addresses
9. Generic greetings vs personalized content
10. Attachment references or download requests

Return ONLY valid JSON in this exact format:
{
  "score": <number 0-100, where 0 is safe and 100 is definitely phishing>,
  "verdict": "<SAFE|SUSPICIOUS|DANGEROUS>",
  "summary": "<one sentence summary>",
  "indicators": [
    {"type": "<indicator category>", "detail": "<specific finding>", "severity": "<low|medium|high>"}
  ],
  "recommendations": ["<actionable recommendation>"]
}

Email to analyze:
{emailContent}
```
