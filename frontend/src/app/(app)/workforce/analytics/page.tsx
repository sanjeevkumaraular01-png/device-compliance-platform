"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { BarChart3, Clock, Gauge, ListChecks, Timer, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { EmptyState, ErrorState } from "@/components/common/states";
import { AreaTrendChart } from "@/components/charts/charts";
import { DateRangeFilter, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { categoryMeta, productiveTone, toneColor } from "@/lib/status";
import { cn } from "@/lib/utils";
import { DepartmentFilter, fmtHours, shiftDate, todayLocal } from "@/components/workforce/common";
import { AppUsageTable, CATEGORY_COLOR, CategoryDonut } from "@/components/workforce/activity-charts";
import { AnalyticsTable, GROUP_BY, GROUP_LABEL, type GroupBy } from "@/components/workforce/analytics/analytics-table";
import { ACTIVITY_CATEGORIES, type AppUsage, type Paginated, type WorkforceAnalytics } from "@/types/api";

const TREND_SERIES = [
  { key: "activePercent", label: "Active %", color: toneColor.primary },
  { key: "productivePercent", label: "Productive %", color: CATEGORY_COLOR.PRODUCTIVE },
  { key: "idlePercent", label: "Idle %", color: toneColor.medium },
];

function dayTick(v: string): string {
  const d = parseISO(v.length === 10 ? `${v}T00:00:00` : v);
  return isValid(d) ? format(d, "MMM d") : v;
}

function avg(values: number[]): number | null {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((a, b) => a + (typeof b === "number" && Number.isFinite(b) ? b : 0), 0);
}

export default function WorkforceAnalyticsPage() {
  const today = React.useMemo(() => todayLocal(), []);
  const [groupBy, setGroupBy] = React.useState<GroupBy>("employee");
  const [range, setRange] = React.useState<{ from: string; to: string }>(() => ({ from: shiftDate(today, -6), to: today }));
  const [departmentId, setDepartmentId] = React.useState<string | undefined>();
  const [category, setCategory] = React.useState<string | undefined>();

  const params = React.useMemo(() => ({ groupBy, from: range.from, to: range.to, departmentId }), [groupBy, range, departmentId]);
  const analytics = useQuery({
    queryKey: ["workforce", "analytics", params],
    queryFn: () => api.get<WorkforceAnalytics>("/workforce/analytics", params),
    placeholderData: keepPreviousData,
  });

  const appParams = React.useMemo(() => ({ from: range.from, to: range.to, departmentId, category }), [range, departmentId, category]);
  const apps = useQuery({
    queryKey: ["workforce", "analytics", "apps", appParams],
    queryFn: async () => normalizeList(await api.get<AppUsage[] | Paginated<AppUsage>>("/workforce/analytics/apps", appParams)).data,
    placeholderData: keepPreviousData,
  });

  const rows = React.useMemo(() => (Array.isArray(analytics.data?.rows) ? analytics.data.rows : []), [analytics.data]);
  const trend = React.useMemo(() => (Array.isArray(analytics.data?.trend) ? analytics.data.trend : []), [analytics.data]);
  const appRows = React.useMemo(() => apps.data ?? [], [apps.data]);

  const kpi = React.useMemo(() => {
    const withTasks = rows.filter((r) => (r.tasksTotal ?? 0) > 0);
    return {
      productive: avg(rows.map((r) => r.productivePercent)),
      active: sum(rows.map((r) => r.activeHours)),
      overtime: sum(rows.map((r) => r.overtimeHours)),
      completion: avg(withTasks.map((r) => r.taskCompletionPercent)),
      tasksDone: sum(rows.map((r) => r.tasksCompleted)),
      tasksTotal: sum(rows.map((r) => r.tasksTotal)),
    };
  }, [rows]);

  const kpiLoading = analytics.isLoading;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

  return (
    <div className="min-w-0">
      <PageHeader
        title="Productivity analytics"
        icon={BarChart3}
        description="Active, productive and idle time, focus and meetings, overtime and task completion — grouped the way you need."
      />

      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        <div role="group" aria-label="Group by" className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md bg-muted p-1">
          {GROUP_BY.map((g) => (
            <Button
              key={g}
              type="button"
              size="xs"
              variant="ghost"
              aria-pressed={groupBy === g}
              onClick={() => setGroupBy(g)}
              className={cn("h-6 px-2.5 text-muted-foreground", groupBy === g && "bg-card text-foreground shadow-sm hover:bg-card")}
            >
              {GROUP_LABEL[g]}
            </Button>
          ))}
        </div>
        <DateRangeFilter
          from={range.from}
          to={range.to}
          onChange={(r) => setRange((prev) => ({ from: r.from ?? prev.from, to: r.to ?? prev.to }))}
        />
        <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Avg productive" value={pct(kpi.productive)} icon={Gauge} tone={kpi.productive === null ? "neutral" : productiveTone(kpi.productive)} sub="of active time" loading={kpiLoading} />
        <KpiCard label="Total active" value={fmtHours(kpi.active)} icon={Clock} tone="primary" sub={`${dayTick(range.from)} – ${dayTick(range.to)}`} loading={kpiLoading} />
        <KpiCard label="Total overtime" value={fmtHours(kpi.overtime)} icon={Timer} tone={kpi.overtime > 0 ? "info" : "neutral"} sub="beyond policy threshold" loading={kpiLoading} />
        <KpiCard
          label="Avg task completion"
          value={pct(kpi.completion)}
          icon={ListChecks}
          tone="neutral"
          sub={kpi.tasksTotal > 0 ? `${kpi.tasksDone}/${kpi.tasksTotal} tasks done` : "No tasks in period"}
          loading={kpiLoading}
        />
      </div>

      <div className="mb-4">
        <AnalyticsTable
          rows={rows}
          groupBy={groupBy}
          loading={analytics.isLoading}
          fetching={analytics.isFetching}
          error={analytics.error}
          onRetry={() => analytics.refetch()}
          from={range.from}
          to={range.to}
        />
      </div>

      <Card className="mb-4 min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" aria-hidden /> Daily trend
          </CardTitle>
          <CardDescription>Active and idle share of tracked time; productive share of active time.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.isLoading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : analytics.error && !analytics.data ? (
            <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} compact />
          ) : trend.length === 0 ? (
            <EmptyState compact icon={TrendingUp} title="No trend data" description="Tracked days in the selected range appear here." />
          ) : (
            <div role="img" aria-label="Line chart of daily active, productive and idle percentages">
              <AreaTrendChart
                data={trend}
                xKey="date"
                series={TREND_SERIES}
                yDomain={[0, 100]}
                xFormatter={dayTick}
                valueFormatter={(v) => `${Math.round(v)}%`}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle>App & website usage</CardTitle>
            <CardDescription>Time per application or website and its productivity category for the selected period.</CardDescription>
          </div>
          <FilterSelect
            label="Category"
            value={category}
            onChange={setCategory}
            options={enumOptions(ACTIVITY_CATEGORIES, (c) => categoryMeta[c].label)}
          />
        </CardHeader>
        <CardContent>
          {apps.isLoading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-[200px] w-full" />
            </div>
          ) : apps.error && !apps.data ? (
            <ErrorState error={apps.error} onRetry={() => apps.refetch()} compact />
          ) : appRows.length === 0 ? (
            <EmptyState compact title="No app or website usage" description="Nothing was tracked for this selection." />
          ) : (
            <div className={cn("grid min-w-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]", apps.isFetching && "opacity-80 transition-opacity")}>
              <div className="min-w-0 rounded-md border p-3">
                <CategoryDonut apps={appRows} />
              </div>
              <div className="min-w-0 overflow-hidden rounded-md border">
                <AppUsageTable apps={appRows} limit={25} maxHeight="22rem" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
