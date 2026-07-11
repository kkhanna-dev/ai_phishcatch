function colorFor(score: number): string {
  if (score <= 30) return "#10b981";
  if (score <= 65) return "#f59e0b";
  return "#ef4444";
}

export default function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const color = colorFor(score);
  return (
    <div
      className="score-ring relative flex shrink-0 items-center justify-center rounded-full"
      style={
        {
          width: size,
          height: size,
          "--ring-color": color,
          "--ring-pct": score,
        } as React.CSSProperties
      }
    >
      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-surface">
        <span className="text-sm font-extrabold" style={{ color }}>
          {score}
        </span>
      </div>
    </div>
  );
}
