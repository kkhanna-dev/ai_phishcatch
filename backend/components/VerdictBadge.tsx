import { Verdict } from "../lib/types";

const STYLES: Record<Verdict, string> = {
  SAFE: "bg-safe/15 text-safe border-safe/30",
  SUSPICIOUS: "bg-suspicious/15 text-suspicious border-suspicious/30",
  DANGEROUS: "bg-dangerous/15 text-dangerous border-dangerous/30",
};

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${STYLES[verdict]}`}
    >
      {verdict}
    </span>
  );
}
