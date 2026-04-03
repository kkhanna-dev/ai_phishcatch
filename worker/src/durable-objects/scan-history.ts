import { ScanHistoryEntry } from "../types";

const MAX_HISTORY = 100;

/**
 * ScanHistory Durable Object — persistent, globally consistent scan log.
 * Stores the last 100 scans with full analysis results.
 */
export class ScanHistory {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/add" && request.method === "POST") {
      const entry = await request.json<ScanHistoryEntry>();
      await this.state.storage.transaction(async (txn) => {
        const history = (await txn.get<ScanHistoryEntry[]>("history")) ?? [];
        history.unshift(entry);
        await txn.put("history", history.slice(0, MAX_HISTORY));
      });
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/history" && request.method === "GET") {
      const history = (await this.state.storage.get<ScanHistoryEntry[]>("history")) ?? [];
      const limit = Math.min(parseInt(new URL(request.url).searchParams.get("limit") ?? "50"), MAX_HISTORY);
      return Response.json(history.slice(0, limit));
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      const history = (await this.state.storage.get<ScanHistoryEntry[]>("history")) ?? [];
      const stats = {
        total: history.length,
        safe: history.filter((e) => e.verdict === "SAFE").length,
        suspicious: history.filter((e) => e.verdict === "SUSPICIOUS").length,
        dangerous: history.filter((e) => e.verdict === "DANGEROUS").length,
        avgScore: history.length
          ? Math.round(history.reduce((s, e) => s + e.score, 0) / history.length)
          : 0,
      };
      return Response.json(stats);
    }

    if (url.pathname === "/clear" && request.method === "DELETE") {
      await this.state.storage.delete("history");
      return new Response("Cleared", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  }
}
