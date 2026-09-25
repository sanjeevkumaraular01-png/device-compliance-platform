import { cn } from "@/lib/utils";
import { scoreTone, toneColor, toneText } from "@/lib/status";

/** Circular compliance score indicator (0-100). */
export function ScoreRing({
  score,
  size = 32,
  stroke = 3.5,
  className,
  showLabel = true,
  labelClassName,
}: {
  score: number | null | undefined;
  size?: number;
  stroke?: number;
  className?: string;
  showLabel?: boolean;
  labelClassName?: string;
}) {
  const s = score === null || score === undefined ? null : Math.max(0, Math.min(100, Math.round(score)));
  const tone = scoreTone(s);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = s === null ? c : c - (s / 100) * c;
  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={s === null ? "No score" : `Compliance score ${s} of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneColor[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
      {showLabel && (
        <span
          className={cn("absolute font-semibold tabular", toneText[tone], labelClassName)}
          style={{ fontSize: Math.max(9, size * 0.3) }}
        >
          {s === null ? "–" : s}
        </span>
      )}
    </div>
  );
}
