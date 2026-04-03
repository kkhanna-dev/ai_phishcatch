import { Env, EmailInput, AnalysisResult } from "./types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `You are an expert email security analyst specializing in phishing detection.
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
generic greetings, mismatched reply-to, attachment/download requests.`;

function buildCacheKey(input: EmailInput): string {
  const raw = `${input.subject ?? ""}|${input.sender ?? ""}|${(input.body ?? "").slice(0, 200)}`;
  // Simple deterministic hash for cache key
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `scan:${Math.abs(hash).toString(36)}`;
}

function extractJson(text: string): AnalysisResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as AnalysisResult;
  } catch {
    return null;
  }
}

export async function handleAnalyze(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  let input: EmailInput;
  try {
    input = await request.json<EmailInput>();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  if (!input.body && !input.subject) {
    return Response.json({ error: "Email body or subject is required" }, { status: 400, headers: CORS_HEADERS });
  }

  // Check KV cache
  const cacheKey = buildCacheKey(input);
  const cached = await env.SCAN_CACHE.get<AnalysisResult>(cacheKey, "json");
  if (cached) {
    return Response.json({ ...cached, cached: true }, { headers: CORS_HEADERS });
  }

  const emailContent = [
    `Subject: ${input.subject ?? "(no subject)"}`,
    `From: ${input.sender ?? "(unknown)"}`,
    `Links: ${input.links?.length ? input.links.join(", ") : "none"}`,
    "",
    input.body ?? "(empty body)",
  ].join("\n").slice(0, 6000);

  // Call Workers AI — Llama 3.3
  let analysisText: string;
  try {
    const aiResponse = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as BaseAiTextGenerationModels, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analyze this email for phishing:\n\n${emailContent}` },
      ],
      max_tokens: 1024,
    }) as { response?: string };
    analysisText = aiResponse.response ?? "";
  } catch (err) {
    console.error("Workers AI error:", err);
    return Response.json({ error: "AI analysis failed" }, { status: 502, headers: CORS_HEADERS });
  }

  const analysis = extractJson(analysisText);
  if (!analysis) {
    console.error("Failed to parse AI response:", analysisText);
    return Response.json({ error: "Failed to parse analysis" }, { status: 500, headers: CORS_HEADERS });
  }

  // Normalise score/verdict consistency
  if (analysis.score <= 30) analysis.verdict = "SAFE";
  else if (analysis.score <= 65) analysis.verdict = "SUSPICIOUS";
  else analysis.verdict = "DANGEROUS";

  // Cache result for 1 hour
  await env.SCAN_CACHE.put(cacheKey, JSON.stringify(analysis), { expirationTtl: 3600 });

  // Persist to Durable Object history
  const historyId = env.SCAN_HISTORY.idFromName("global");
  const historyStub = env.SCAN_HISTORY.get(historyId);
  await historyStub.fetch(
    new Request("https://internal/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...analysis,
        subject: input.subject ?? "",
        sender: input.sender ?? "",
        timestamp: Date.now(),
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    })
  );

  return Response.json(analysis, { headers: CORS_HEADERS });
}

export { CORS_HEADERS };
