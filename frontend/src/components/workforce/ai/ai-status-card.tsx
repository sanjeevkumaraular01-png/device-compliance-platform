"use client";

import * as React from "react";
import Link from "next/link";
import { Bot, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badges";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Metric } from "@/components/workforce/common";
import { useAiStatus } from "@/components/workforce/queries";
import type { Tone } from "@/lib/status";

const runStatusMeta: Record<string, { label: string; tone: Tone }> = {
  COMPLETED: { label: "Completed", tone: "success" },
  ENDED: { label: "Completed", tone: "success" },
  SUCCEEDED: { label: "Completed", tone: "success" },
  READY: { label: "Completed", tone: "success" },
  RUNNING: { label: "Running", tone: "info" },
  IN_PROGRESS: { label: "Running", tone: "info" },
  PENDING: { label: "Pending", tone: "medium" },
  PARTIAL: { label: "Partial", tone: "medium" },
  FAILED: { label: "Failed", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "unknown" },
};

function cachedShare(input: number | null | undefined, cached: number | null | undefined): string | undefined {
  const i = input ?? 0;
  const c = cached ?? 0;
  return i + c > 0 && c > 0 ? `${Math.round((c / (i + c)) * 100)}% of input cached` : undefined;
}

/** `GET /ai/status` — whether Claude summaries are enabled, which model, and the last nightly run. */
export function AiStatusCard({ className, showLink = false }: { className?: string; showLink?: boolean }) {
  const q = useAiStatus();
  const s = q.data;
  const run = s?.lastRun ?? null;
  const statusKey = run?.status?.toUpperCase() ?? "";

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="flex-row flex-wrap items-center gap-2 border-b pb-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
        <CardTitle className="mr-auto">AI Work Intelligence status</CardTitle>
        {s && (
          <Badge tone={s.enabled ? "success" : "unknown"} dot>
            {s.enabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
        {s?.model && <Badge tone="neutral" className="font-mono">{s.model}</Badge>}
        {showLink && (
          <Button asChild variant="outline" size="xs">
            <Link href="/workforce/ai">Open AI insights</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-3">
        {q.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => q.refetch()} title="Could not load AI status" />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {!s?.enabled && (
              <div className="flex items-start gap-2 rounded-md border border-sev-medium/30 bg-sev-medium/10 px-3 py-2 text-xs">
                <KeyRound className="mt-px size-3.5 shrink-0 text-sev-medium" />
                <div className="grid grid-cols-1 gap-1">
                  <span className="font-medium">AI summaries are disabled.</span>
                  <span>
                    Add <code className="font-mono">ANTHROPIC_API_KEY</code> to the backend environment (and keep the <code className="font-mono">aiEnabled</code>{" "}
                    setting on) to enable nightly summaries. Optional: <code className="font-mono">AI_MODEL</code> (default claude-opus-5),{" "}
                    <code className="font-mono">AI_EFFORT</code>, <code className="font-mono">AI_DAILY_RUN_TIME</code> (default 20:30, org time zone) and{" "}
                    <code className="font-mono">AI_MAX_EMPLOYEES_PER_RUN</code>. Restart the backend after changing the environment.
                  </span>
                </div>
              </div>
            )}
            {run ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Last nightly run: <span className="font-medium text-foreground">{formatDate(run.date)}</span>
                  </span>
                  <StatusBadge value={statusKey || null} meta={runStatusMeta} />
                  {run.batchId && (
                    <span className="max-w-full truncate font-mono text-[11px]" title={run.batchId}>
                      {run.batchId}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Metric label="Employees" value={formatNumber(run.employees)} />
                  <Metric label="Succeeded" value={formatNumber(run.succeeded)} tone={run.succeeded > 0 ? "success" : undefined} />
                  <Metric label="Failed" value={formatNumber(run.failed)} tone={run.failed > 0 ? "critical" : undefined} />
                  <Metric label="Input tokens" value={formatNumber(run.inputTokens)} />
                  <Metric label="Output tokens" value={formatNumber(run.outputTokens)} />
                  <Metric
                    label="Cache read tokens"
                    value={formatNumber(run.cacheReadTokens)}
                    sub={cachedShare(run.inputTokens, run.cacheReadTokens)}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No nightly run yet. Summaries are generated once a day after the configured run time for every employee with activity or a daily report.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
