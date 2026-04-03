import { Env } from "./types";
import { handleAnalyze, CORS_HEADERS } from "./analyze";

export { ScanHistory } from "./durable-objects/scan-history";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Global CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }

    // POST /api/analyze — analyze email with Workers AI (Llama 3.3)
    if (url.pathname === "/api/analyze") {
      return handleAnalyze(request, env);
    }

    // GET /api/history — retrieve scan history from Durable Object
    if (url.pathname === "/api/history" && request.method === "GET") {
      const id = env.SCAN_HISTORY.idFromName("global");
      const stub = env.SCAN_HISTORY.get(id);
      return stub.fetch(
        new Request(`https://internal/history?${url.searchParams}`, { method: "GET" })
      ).then((res) => new Response(res.body, { status: res.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }));
    }

    // GET /api/stats — aggregate stats from Durable Object
    if (url.pathname === "/api/stats" && request.method === "GET") {
      const id = env.SCAN_HISTORY.idFromName("global");
      const stub = env.SCAN_HISTORY.get(id);
      return stub.fetch(
        new Request("https://internal/stats", { method: "GET" })
      ).then((res) => new Response(res.body, { status: res.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }));
    }

    // GET / — health check / landing
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json(
        {
          name: "cf-ai-phishcatch",
          description: "AI-powered email phishing detection — Cloudflare Workers + Llama 3.3",
          endpoints: {
            "POST /api/analyze": "Analyze an email for phishing indicators",
            "GET /api/history": "Retrieve recent scan history (Durable Object)",
            "GET /api/stats": "Aggregate scan statistics",
          },
        },
        { headers: CORS_HEADERS }
      );
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
