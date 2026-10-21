import * as React from "react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Headline count shown above a list page. `value` undefined renders a dash (loading or not available). */
export function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", warn ? "bg-sev-medium/15 text-sev-medium" : "bg-primary/10 text-primary")}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums leading-tight">{value === undefined ? "—" : formatNumber(value)}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}
