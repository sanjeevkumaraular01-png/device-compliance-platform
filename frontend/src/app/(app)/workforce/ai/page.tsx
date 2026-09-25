"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateInput, DepartmentFilter, shiftDate, todayLocal } from "@/components/workforce/common";
import { AiDisclaimer } from "@/components/workforce/ai-insight-view";
import { useAiStatus } from "@/components/workforce/queries";
import { AiStatusCard } from "@/components/workforce/ai/ai-status-card";
import { ManagementSummary } from "@/components/workforce/ai/management-summary";
import { EmployeeInsights } from "@/components/workforce/ai/employee-insights";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function WorkforceAiPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <WorkforceAiInner />
    </React.Suspense>
  );
}

function WorkforceAiInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = todayLocal();
  const rawDate = searchParams.get("date");
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : today;
  const departmentId = searchParams.get("departmentId") || undefined;
  const status = useAiStatus();
  const aiEnabled = status.data?.enabled;

  const update = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (p.get("date") === today) p.delete("date");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setDate = (d: string) => update({ date: d });

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <PageHeader
        title="AI Work Intelligence"
        icon={Bot}
        description="Daily summaries by Claude: what each employee worked on, blockers, workload, report consistency and a management overview."
        className="mb-0"
      >
        <AiDisclaimer className="mt-1.5 max-w-3xl" />
      </PageHeader>

      <AiStatusCard />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
            <ChevronLeft />
          </Button>
          <DateInput value={date} onChange={setDate} max={today} label="Insight date" />
          <Button variant="outline" size="icon-sm" aria-label="Next day" disabled={date >= today} onClick={() => setDate(shiftDate(date, 1))}>
            <ChevronRight />
          </Button>
        </div>
        {date !== today && (
          <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
            Today
          </Button>
        )}
        <DepartmentFilter value={departmentId} onChange={(v) => update({ departmentId: v })} />
        {!departmentId && <span className="text-xs text-muted-foreground">Organization-wide</span>}
      </div>

      <ManagementSummary date={date} departmentId={departmentId} aiEnabled={aiEnabled} onDateChange={setDate} />
      <EmployeeInsights date={date} departmentId={departmentId} aiEnabled={aiEnabled} />
    </div>
  );
}
