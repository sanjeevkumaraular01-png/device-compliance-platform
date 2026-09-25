"use client";

import Link from "next/link";
import { ArrowRight, ClipboardX, Clock, UsersRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatPercent } from "@/lib/format";
import { productiveTone, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useWorkforceSummary } from "@/components/workforce/queries";

function Stat({ icon: Icon, label, value, className }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 leading-tight">
        <div className={cn("text-base font-semibold tabular", className)}>{value}</div>
        <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

/** Compact workforce strip for the main dashboard (users with `workforce:read`). Silently hidden when unavailable. */
export function WorkforceTeaser() {
  const { can } = useAuth();
  const enabled = can("workforce:read");
  const q = useWorkforceSummary({}, enabled);
  if (!enabled || q.isError) return null;
  const s = q.data;
  return (
    <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-6 sm:px-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <UsersRound className="size-4 text-primary" /> Workforce today
      </div>
      {!s ? (
        <div className="flex flex-1 gap-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-8">
          <Stat
            icon={UsersRound}
            label={`online of ${formatNumber(s.totalEmployees)}`}
            value={formatNumber(s.online)}
            className="text-sev-none"
          />
          <Stat icon={Clock} label="late today" value={formatNumber(s.late)} className={s.late > 0 ? "text-sev-medium" : undefined} />
          <Stat
            icon={ClipboardX}
            label="reports missing"
            value={formatNumber(s.reportsMissing)}
            className={s.reportsMissing > 0 ? "text-sev-critical" : undefined}
          />
          <Stat icon={UsersRound} label="avg productive" value={formatPercent(s.avgProductivePercent, 0)} className={toneText[productiveTone(s.avgProductivePercent)]} />
        </div>
      )}
      <Link href="/workforce" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Live dashboard <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}
