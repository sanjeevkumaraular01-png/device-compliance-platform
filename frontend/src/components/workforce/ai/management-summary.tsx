"use client";

import * as React from "react";
import { History, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import { AiGeneratedBadge, fmtDay } from "@/components/workforce/common";
import { ManagementInsightView } from "@/components/workforce/ai-insight-view";
import { useAiInsights } from "@/components/workforce/queries";
import type { AiInsight, ManagementInsight } from "@/types/api";

function pickLatest(list: AiInsight[] | undefined, departmentId: string | undefined): AiInsight | undefined {
  return (list ?? [])
    .filter((i) => i.type === "MANAGEMENT_DAILY" && (departmentId ? i.departmentId === departmentId : !i.departmentId))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.completedAt ?? b.createdAt ?? "").localeCompare(a.completedAt ?? a.createdAt ?? ""))[0];
}

export function ManagementSummary({
  date,
  departmentId,
  aiEnabled,
  onDateChange,
}: {
  date: string;
  departmentId: string | undefined;
  /** false when `/ai/status` reports AI disabled (undefined = unknown). */
  aiEnabled: boolean | undefined;
  onDateChange: (d: string) => void;
}) {
  const deps = useDepartments();
  const scopeName = departmentId ? (deps.data?.find((d) => d.id === departmentId)?.name ?? "Department") : "Organization-wide";
  const q = useAiInsights({ type: "MANAGEMENT_DAILY", date, departmentId });
  const insight = pickLatest(q.data, departmentId);

  // When nothing exists for the chosen day, look up the most recent summary for this scope.
  const latest = useAiInsights({ type: "MANAGEMENT_DAILY", departmentId }, !q.isLoading && !q.isError && !insight);
  const latestInsight = !insight ? pickLatest(latest.data, departmentId) : undefined;
  const latestDate = latestInsight?.date?.slice(0, 10);

  const generate = useApiMutation(
    () => api.post<AiInsight>("/ai/insights/management", departmentId ? { date, departmentId } : { date }),
    {
      success: "Management summary generated",
      errorTitle: "Could not generate the summary",
      invalidate: [["ai"]],
    },
  );

  const genButton = (
    <Button
      size="sm"
      variant={insight ? "outline" : "default"}
      onClick={() => generate.mutate()}
      loading={generate.isPending}
      disabled={aiEnabled === false}
      title={aiEnabled === false ? "AI is disabled — see the status card" : undefined}
    >
      <Sparkles /> {insight ? "Regenerate" : "Generate now"}
    </Button>
  );

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-start gap-2 border-b pb-3">
        <div className="grid grid-cols-1 min-w-0 flex-1 gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            Management summary <AiGeneratedBadge />
          </CardTitle>
          <CardDescription>
            {scopeName} · {fmtDay(date, "EEEE, MMM d, yyyy")}
          </CardDescription>
        </div>
        {genButton}
      </CardHeader>
      <CardContent className="pt-4">
        {generate.isPending && (
          <div className="mb-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs" role="status">
            <Loader2 className="size-3.5 animate-spin" /> Claude is summarizing the employee insights for this scope — this can take up to a minute.
          </div>
        )}
        {q.isLoading ? (
          <div className="grid grid-cols-1 gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </div>
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
        ) : insight ? (
          <ManagementInsightView insight={insight as AiInsight<ManagementInsight>} />
        ) : (
          <EmptyState
            compact
            icon={Sparkles}
            title="No management summary for this day"
            description={
              <>
                Summaries are generated nightly after the AI run time (default 20:30, org time zone), once employee insights are ready. You can also generate
                one now{departmentId ? " for this department" : ""}.
              </>
            }
            action={
              latestDate && latestDate !== date ? (
                <Button size="sm" variant="outline" onClick={() => onDateChange(latestDate)}>
                  <History /> View latest ({fmtDay(latestDate)})
                </Button>
              ) : undefined
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
