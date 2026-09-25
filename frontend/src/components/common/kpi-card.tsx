import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toneBadge, toneDot, toneText, type Tone } from "@/lib/status";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "primary",
  href,
  loading,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  href?: string;
  loading?: boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-2 overflow-hidden rounded-lg border bg-card p-4 shadow-xs transition-colors",
        href && "hover:border-primary/40 hover:bg-accent/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-md ring-1 ring-inset", toneBadge[tone])}>
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      {loading ? (
        <>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-28" />
        </>
      ) : (
        <>
          <div className={cn("text-2xl font-semibold tracking-tight tabular", tone !== "primary" && tone !== "neutral" ? toneText[tone] : "")}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </>
      )}
      {footer && !loading && <div className="mt-auto pt-1">{footer}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Horizontal stacked bar showing segment proportions. */
export function SegmentBar({
  segments,
  className,
}: {
  segments: { value: number; tone: Tone; label: string }[];
  className?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
      {total > 0 &&
        segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} className={cn("h-full", toneDot[s.tone])} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
          ) : null,
        )}
    </div>
  );
}
