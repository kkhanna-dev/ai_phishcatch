import { AnalysisResult } from "../lib/types";
import ScoreRing from "./ScoreRing";
import VerdictBadge from "./VerdictBadge";

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-dangerous",
  medium: "bg-suspicious",
  low: "bg-safe",
};

export default function ResultCard({ result, cached }: { result: AnalysisResult; cached?: boolean }) {
  return (
    <div className="animate-slide-up rounded-2xl border border-border bg-surface-2 p-5">
      <div className="mb-3 flex items-center gap-3">
        <ScoreRing score={result.score} />
        <div className="flex-1">
          <VerdictBadge verdict={result.verdict} />
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{result.summary}</p>
        </div>
      </div>

      {result.indicators?.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Indicators</p>
          {result.indicators.map((ind, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[ind.severity]}`} />
              <span>
                <strong className="font-semibold">{ind.type}</strong>: {ind.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.recommendations?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recommendations</p>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {result.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent-light">›</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cached && <p className="mt-3 text-xs text-slate-500">Cached result</p>}
    </div>
  );
}
