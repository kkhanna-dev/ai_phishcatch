"use client";

import { useEffect, useMemo, useState } from "react";
import ResultCard from "./ResultCard";
import { AnalysisResult, HistoryEntry } from "../lib/types";

const HISTORY_KEY = "phishcatch:history";
const MAX_HISTORY = 50;

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded situations — fail silently.
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AnalyzerApp() {
  const [subject, setSubject] = useState("");
  const [sender, setSender] = useState("");
  const [body, setBody] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [links, setLinks] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [lastSubject, setLastSubject] = useState("");
  const [lastSender, setLastSender] = useState("");

  const [tab, setTab] = useState<"results" | "history">("results");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const stats = useMemo(() => {
    return {
      total: history.length,
      safe: history.filter((h) => h.verdict === "SAFE").length,
      suspicious: history.filter((h) => h.verdict === "SUSPICIOUS").length,
      dangerous: history.filter((h) => h.verdict === "DANGEROUS").length,
    };
  }, [history]);

  function addLink() {
    const val = linkInput.trim();
    if (val && !links.includes(val)) setLinks([...links, val]);
    setLinkInput("");
  }

  function removeLink(i: number) {
    setLinks(links.filter((_, idx) => idx !== i));
  }

  async function analyze() {
    if (!subject.trim() && !body.trim()) {
      setError("Please enter at least a subject or email body.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setLastSubject(subject);
    setLastSender(sender);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, sender, body, links }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      setResult(data);

      const entry: HistoryEntry = {
        ...data,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subject,
        sender,
        timestamp: Date.now(),
      };
      const updated = [entry, ...history];
      setHistory(updated);
      saveHistory(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function viewHistoryEntry(entry: HistoryEntry) {
    setTab("results");
    setResult(entry);
    setLastSubject(entry.subject);
    setLastSender(entry.sender);
    setError(null);
  }

  function clearHistory() {
    setHistory([]);
    saveHistory([]);
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" />

      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-purple-500 shadow-glow">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2 3 6v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V6l-9-4Z"
              fill="white"
              opacity="0.95"
            />
          </svg>
        </div>
        <div>
          <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">
            PhishCatch
          </h1>
          <p className="text-xs text-slate-500">Rule-based phishing detection — no AI, no API costs</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-16 lg:grid-cols-2">
        {/* Analyzer form */}
        <section className="rounded-2xl border border-border bg-surface/80 p-6 backdrop-blur">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Analyze an email</h2>

          <label className="mb-1 block text-xs font-semibold text-slate-400">Subject</label>
          <input
            className="mb-4 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-accent"
            placeholder="Urgent: verify your account"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={500}
          />

          <label className="mb-1 block text-xs font-semibold text-slate-400">Sender</label>
          <input
            className="mb-4 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-accent"
            placeholder="security@example.com"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            maxLength={320}
          />

          <label className="mb-1 block text-xs font-semibold text-slate-400">Email body</label>
          <textarea
            className="mb-4 min-h-[140px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-accent"
            placeholder="Paste the email content here…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8000}
          />

          <label className="mb-1 block text-xs font-semibold text-slate-400">Links in email</label>
          <div className="mb-2 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-accent"
              placeholder="https://…"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())}
            />
            <button
              onClick={addLink}
              type="button"
              className="rounded-lg border border-border bg-white/5 px-3 text-lg leading-none transition hover:border-accent hover:bg-accent/20"
            >
              +
            </button>
          </div>
          {links.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {links.map((l, i) => (
                <span
                  key={i}
                  className="flex max-w-[220px] items-center gap-1 truncate rounded-md border border-border bg-bg px-2 py-1 text-xs text-slate-400"
                  title={l}
                >
                  <span className="truncate">{l}</span>
                  <button onClick={() => removeLink(i)} className="opacity-60 hover:opacity-100" aria-label="Remove link">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <button
            onClick={analyze}
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-r from-accent to-purple-500 py-2.5 text-sm font-bold text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Analyzing…" : "Scan for phishing"}
          </button>
        </section>

        {/* Results / history */}
        <section className="flex min-h-[480px] flex-col rounded-2xl border border-border bg-surface/80 backdrop-blur">
          <div className="flex border-b border-border">
            <button
              onClick={() => setTab("results")}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition ${
                tab === "results" ? "border-b-2 border-accent text-accent-light" : "text-slate-500"
              }`}
            >
              Results
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition ${
                tab === "history" ? "border-b-2 border-accent text-accent-light" : "text-slate-500"
              }`}
            >
              History ({history.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {tab === "results" ? (
              <>
                {!result && !loading && !error && (
                  <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-slate-500">
                    <span className="text-4xl">🔍</span>
                    <p className="text-sm">Paste an email and click Scan for phishing to analyze it.</p>
                  </div>
                )}

                {loading && (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-4 text-sm text-slate-400">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
                    Analyzing…
                  </div>
                )}

                {error && !loading && (
                  <div className="rounded-xl border border-dangerous/30 bg-dangerous/10 px-4 py-3 text-sm text-dangerous">
                    ⚠ {error}
                  </div>
                )}

                {result && !loading && (
                  <div className="space-y-3">
                    {(lastSubject || lastSender) && (
                      <div className="rounded-xl border border-border bg-bg px-4 py-2.5 text-xs text-slate-400">
                        {lastSubject && <div className="font-semibold text-slate-300">&ldquo;{lastSubject}&rdquo;</div>}
                        {lastSender && <div>From: {lastSender}</div>}
                      </div>
                    )}
                    <ResultCard result={result} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-4 gap-2">
                  <StatCard label="Total" value={stats.total} />
                  <StatCard label="Safe" value={stats.safe} className="text-safe" />
                  <StatCard label="Suspicious" value={stats.suspicious} className="text-suspicious" />
                  <StatCard label="Dangerous" value={stats.dangerous} className="text-dangerous" />
                </div>

                {history.length === 0 ? (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center text-slate-500">
                    <span className="text-3xl">📋</span>
                    <p className="text-sm">No scans yet. History is stored only in this browser.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => viewHistoryEntry(entry)}
                        className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2.5 text-left text-sm transition hover:border-accent"
                      >
                        <span
                          className="w-8 shrink-0 text-center text-sm font-extrabold"
                          style={{
                            color: entry.score <= 30 ? "#10b981" : entry.score <= 65 ? "#f59e0b" : "#ef4444",
                          }}
                        >
                          {entry.score}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{entry.subject || "(no subject)"}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {entry.sender || "Unknown sender"} · {timeAgo(entry.timestamp)}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold">
                          {entry.verdict}
                        </span>
                      </button>
                    ))}
                    <button
                      onClick={clearHistory}
                      className="mt-2 w-full rounded-lg border border-dangerous/30 py-2 text-xs font-semibold text-dangerous transition hover:bg-dangerous/10"
                    >
                      Clear history
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-8 text-center text-xs text-slate-600">
        Scan results are generated by a deterministic rule-based engine (not AI) and may be imperfect — always use your own judgment before clicking links or sharing information.
      </footer>
    </div>
  );
}

function StatCard({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-2 py-2.5 text-center">
      <div className={`text-lg font-extrabold ${className}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
