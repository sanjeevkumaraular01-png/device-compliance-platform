"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlarmClock,
  AppWindow,
  Building2,
  ClipboardCheck,
  Coffee,
  Gauge,
  LayoutGrid,
  List,
  MoonStar,
  RefreshCw,
  Search,
  Siren,
  UserCheck,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard, SegmentBar } from "@/components/common/kpi-card";
import { RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState } from "@/components/common/states";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect, enumOptions } from "@/components/data-table/filters";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatPercent } from "@/lib/format";
import { liveStatusMeta, productiveTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TopAppsChart } from "@/components/workforce/activity-charts";
import {
  CategoryBadge,
  DepartmentFilter,
  LateBadge,
  LiveStatusBadge,
  LocationBadge,
  PercentBar,
  PersonCell,
  fmtHm,
  fmtTime,
} from "@/components/workforce/common";
import { useWorkforceLive, useWorkforceSummary } from "@/components/workforce/queries";
import { LIVE_STATUSES, type LiveEmployee } from "@/types/api";

const VIEW_KEY = "sem.workforce.liveView";

function useViewMode(): ["grid" | "table", (v: "grid" | "table") => void] {
  const [view, setView] = React.useState<"grid" | "table">("table");
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "table") setView(v);
    } catch {
      /* ignore */
    }
  }, []);
  const set = React.useCallback((v: "grid" | "table") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);
  return [view, set];
}

function currentActivity(e: LiveEmployee) {
  const what = e.currentDomain ?? e.currentApp;
  if (!what) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-xs" title={what}>
        {what}
      </span>
      {e.currentCategory && <CategoryBadge value={e.currentCategory} />}
    </span>
  );
}

function KpiStrip({ departmentId }: { departmentId?: string }) {
  const { can } = useAuth();
  const q = useWorkforceSummary({ departmentId });
  const s = q.data;
  const loading = q.isLoading || (!s && !q.isError);
  if (q.isError && !s) {
    return (
      <Card>
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} title="Could not load the workforce summary" />
      </Card>
    );
  }
  const total = s?.totalEmployees ?? 0;
  const reportsTotal = (s?.reportsSubmitted ?? 0) + (s?.reportsMissing ?? 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      <KpiCard
        label="Employees"
        icon={UsersRound}
        loading={loading}
        value={formatNumber(total)}
        sub={`${formatNumber(s?.onLeave)} on leave`}
        footer={
          <SegmentBar
            segments={[
              { value: s?.activeNow ?? 0, tone: "success", label: "Active" },
              { value: s?.idleNow ?? 0, tone: "medium", label: "Idle" },
              { value: s?.onBreak ?? 0, tone: "info", label: "On break" },
              { value: s?.offline ?? 0, tone: "unknown", label: "Offline" },
            ]}
          />
        }
      />
      <KpiCard label="Online now" icon={UserCheck} tone="success" loading={loading} value={formatNumber(s?.online)} sub={`${formatPercent(total ? ((s?.online ?? 0) / total) * 100 : 0, 0)} of workforce`} />
      <KpiCard label="Active now" icon={Zap} tone="success" loading={loading} value={formatNumber(s?.activeNow)} sub={`${formatNumber(s?.idleNow)} idle · ${formatNumber(s?.onBreak)} on break`} />
      <KpiCard label="Idle now" icon={MoonStar} tone={(s?.idleNow ?? 0) > 0 ? "medium" : "neutral"} loading={loading} value={formatNumber(s?.idleNow)} sub="No input past idle threshold" />
      <KpiCard label="On break" icon={Coffee} tone="info" loading={loading} value={formatNumber(s?.onBreak)} sub="Break started, not ended" />
      <KpiCard
        label="Offline / absent"
        icon={UsersRound}
        tone={(s?.absent ?? 0) > 0 ? "critical" : "neutral"}
        loading={loading}
        value={
          <>
            {formatNumber(s?.offline)} <span className="text-base text-muted-foreground">/ {formatNumber(s?.absent)}</span>
          </>
        }
        sub="Offline · absent (work day, no activity)"
      />
      <KpiCard label="Late today" icon={AlarmClock} tone={(s?.late ?? 0) > 0 ? "medium" : "success"} loading={loading} value={formatNumber(s?.late)} sub="Clock-in after start + grace" />
      <KpiCard
        label="Office / remote"
        icon={Building2}
        loading={loading}
        value={
          <>
            {formatNumber(s?.office)} <span className="text-base text-muted-foreground">/ {formatNumber(s?.remote)}</span>
          </>
        }
        sub="By agent-reported network"
        footer={
          <SegmentBar
            segments={[
              { value: s?.office ?? 0, tone: "primary", label: "Office" },
              { value: s?.remote ?? 0, tone: "info", label: "Remote" },
            ]}
          />
        }
      />
      <KpiCard
        label="Avg productive"
        icon={Gauge}
        tone={productiveTone(s?.avgProductivePercent)}
        loading={loading}
        value={formatPercent(s?.avgProductivePercent, 0)}
        sub={`Active ${formatPercent(s?.avgActivePercent, 0)} · ${formatNumber(s?.totalActiveHours, 1)} h total`}
      />
      <KpiCard
        label="Daily reports"
        icon={ClipboardCheck}
        tone={(s?.reportsMissing ?? 0) > 0 ? "high" : "success"}
        loading={loading}
        href="/workforce/reports?tab=team"
        value={
          <>
            {formatNumber(s?.reportsSubmitted)} <span className="text-base text-muted-foreground">/ {formatNumber(reportsTotal)}</span>
          </>
        }
        sub={`${formatNumber(s?.reportsMissing)} missing`}
      />
      <KpiCard
        label="Open workforce alerts"
        icon={Siren}
        tone={(s?.openWorkAlerts ?? 0) > 0 ? "high" : "success"}
        loading={loading}
        href={can("alerts:read") ? "/alerts?category=WORKFORCE" : undefined}
        value={formatNumber(s?.openWorkAlerts)}
        sub="Late, idle, overload, blocked apps…"
      />
      <KpiCard label="Overtime" icon={AlarmClock} tone="neutral" loading={loading} value={`${formatNumber(s?.totalOvertimeHours, 1)} h`} sub="Across all employees today" />
    </div>
  );
}

function EmployeeCard({ e, onOpen }: { e: LiveEmployee; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${e.displayName}'s day`}
      className="group flex h-full min-w-0 flex-col gap-2.5 rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <PersonCell name={e.displayName} sub={e.department?.name ?? e.jobTitle ?? e.email} />
        <LiveStatusBadge status={e.status} className="shrink-0" />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <LocationBadge value={e.location} />
        <LateBadge minutes={e.lateMinutes} />
      </div>
      <div className="grid w-full grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">In</div>
          <div className="font-medium tabular">{fmtTime(e.clockInAt)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Active</div>
          <div className="font-medium tabular">{fmtHm(e.activeSec)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Idle</div>
          <div className="font-medium tabular">{fmtHm(e.idleSec)}</div>
        </div>
      </div>
      <PercentBar value={e.productivePercent} label={`${e.displayName} productive percent`} className="w-full" />
      <div className="grid grid-cols-1 w-full gap-1 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <ClipboardCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{e.currentTask ? e.currentTask.title : <span className="text-muted-foreground">No task selected</span>}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <AppWindow className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {currentActivity(e)}
        </div>
      </div>
    </button>
  );
}

function LiveEmployees({ departmentId }: { departmentId?: string }) {
  const router = useRouter();
  const [view, setView] = useViewMode();
  const [status, setStatus] = React.useState<string | undefined>();
  const [search, setSearch] = React.useState("");
  const debounced = useDebounce(search.trim(), 300);
  const q = useWorkforceLive({ departmentId, status, search: debounced || undefined });
  const rows = q.data ?? [];
  const open = React.useCallback((e: LiveEmployee) => router.push(`/workforce/people/${e.userId}`), [router]);

  const columns = React.useMemo<ColumnDef<LiveEmployee, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.displayName,
        header: "Employee",
        meta: { label: "Employee" },
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            <PersonCell name={row.original.displayName} sub={row.original.department?.name ?? row.original.jobTitle ?? row.original.email} />
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => LIVE_STATUSES.indexOf(r.status),
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-0.5">
            <LiveStatusBadge status={row.original.status} />
            <LateBadge minutes={row.original.lateMinutes} />
          </div>
        ),
      },
      {
        id: "clockIn",
        accessorFn: (r) => r.clockInAt ?? "",
        header: "Clock in",
        meta: { label: "Clock in", className: "tabular" },
        cell: ({ row }) => <span className="text-xs">{fmtTime(row.original.clockInAt)}</span>,
      },
      {
        id: "firstLast",
        enableSorting: false,
        header: "First / last activity",
        meta: { label: "First / last activity" },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-xs">
            <span className="tabular">{fmtTime(row.original.firstActivityAt)}</span>
            <span className="text-muted-foreground"> · </span>
            <RelativeTime value={row.original.lastActivityAt} fallback="—" className="text-muted-foreground" />
          </div>
        ),
      },
      {
        id: "active",
        accessorFn: (r) => r.activeSec,
        header: "Active",
        meta: { label: "Active time", className: "tabular text-right", headerClassName: "text-right" },
        cell: ({ row }) => <span className="text-xs">{fmtHm(row.original.activeSec)}</span>,
      },
      {
        id: "idle",
        accessorFn: (r) => r.idleSec,
        header: "Idle",
        meta: { label: "Idle time", className: "tabular text-right", headerClassName: "text-right" },
        cell: ({ row }) => <span className="text-xs">{fmtHm(row.original.idleSec)}</span>,
      },
      {
        id: "productiveSec",
        accessorFn: (r) => r.productiveSec,
        header: "Productive",
        meta: { label: "Productive time", className: "tabular text-right", headerClassName: "text-right" },
        cell: ({ row }) => <span className="text-xs">{fmtHm(row.original.productiveSec)}</span>,
      },
      {
        id: "productivePercent",
        accessorFn: (r) => r.productivePercent,
        header: "Productive %",
        meta: { label: "Productive %" },
        cell: ({ row }) => <PercentBar value={row.original.productivePercent} label={`${row.original.displayName} productive percent`} className="w-28" />,
      },
      {
        id: "task",
        accessorFn: (r) => r.currentTask?.title ?? "",
        header: "Current task",
        meta: { label: "Current task" },
        cell: ({ row }) =>
          row.original.currentTask ? (
            <div className="max-w-[220px]">
              <div className="truncate text-xs font-medium" title={row.original.currentTask.title}>
                {row.original.currentTask.title}
              </div>
              {row.original.currentTask.projectName && <div className="truncate text-[11px] text-muted-foreground">{row.original.currentTask.projectName}</div>}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "app",
        enableSorting: false,
        header: "Current app / site",
        meta: { label: "Current app / site" },
        cell: ({ row }) => <div className="max-w-[240px]">{currentActivity(row.original)}</div>,
      },
      {
        id: "location",
        accessorFn: (r) => r.location,
        header: "Location",
        meta: { label: "Location" },
        cell: ({ row }) => <LocationBadge value={row.original.location} />,
      },
    ],
    [],
  );

  const filters = (
    <>
      <FilterSelect label="Status" value={status} onChange={setStatus} options={enumOptions(LIVE_STATUSES, (v) => liveStatusMeta[v].label)} />
    </>
  );

  const viewToggle = (
    <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Layout">
      <Button variant={view === "table" ? "secondary" : "ghost"} size="icon-xs" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
        <List />
      </Button>
      <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon-xs" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
        <LayoutGrid />
      </Button>
    </div>
  );

  if (view === "table") {
    return (
      <DataTable
        columns={columns}
        data={rows}
        loading={q.isLoading}
        fetching={q.isFetching && !q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        getRowId={(r) => r.userId}
        onRowClick={open}
        rowClassName={(r) => (r.status === "OFFLINE" || r.status === "CLOCKED_OUT" ? "opacity-75" : undefined)}
        search={{ value: search, onChange: setSearch, placeholder: "Search employees…" }}
        filters={filters}
        actions={viewToggle}
        initialColumnVisibility={{ productiveSec: false, idle: false }}
        pageSizeOptions={[25, 50, 100, 200]}
        empty={{ icon: UsersRound, title: "No employees match", description: "Nobody matches the current filters, or no tracked employees are in your scope yet." }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 min-w-0 gap-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-xs sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" aria-label="Search employees" className="h-8 pl-8 pr-7 text-xs" />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {filters}
        </div>
        {viewToggle}
      </div>
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : q.isError && rows.length === 0 ? (
        <Card>
          <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState compact icon={UsersRound} title="No employees match" description="Nobody matches the current filters, or no tracked employees are in your scope yet." />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((e) => (
            <li key={e.userId} className="min-w-0">
              <EmployeeCard e={e} onOpen={() => open(e)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DepartmentBreakdown({ departmentId }: { departmentId?: string }) {
  const q = useWorkforceSummary({ departmentId });
  const rows = q.data?.byDepartment ?? [];
  return (
    <WidgetCard title="By department" description="Presence, lateness and productivity today" icon={Building2} className="xl:col-span-3" contentClassName="px-0 pb-0">
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-2 px-4 pb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : q.isError && rows.length === 0 ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact title="No departments" description="Department figures appear once employees are tracked." />
      ) : (
        <Table containerStyle={{ maxHeight: "22rem" }}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Employees</TableHead>
              <TableHead className="text-right">Online</TableHead>
              <TableHead className="text-right">Late</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="w-40">Productive</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.departmentId ?? d.departmentName}>
                <TableCell className="py-1.5 font-medium">{d.departmentName}</TableCell>
                <TableCell className="py-1.5 text-right tabular">{formatNumber(d.employees)}</TableCell>
                <TableCell className="py-1.5 text-right tabular text-sev-none">{formatNumber(d.online)}</TableCell>
                <TableCell className={cn("py-1.5 text-right tabular", d.late > 0 && "text-sev-medium")}>{formatNumber(d.late)}</TableCell>
                <TableCell className={cn("py-1.5 text-right tabular", d.absent > 0 && "text-sev-critical")}>{formatNumber(d.absent)}</TableCell>
                <TableCell className="py-1.5">
                  <PercentBar value={d.avgProductivePercent} label={`${d.departmentName} average productive percent`} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetCard>
  );
}

function TopApps({ departmentId }: { departmentId?: string }) {
  const q = useWorkforceSummary({ departmentId });
  return (
    <WidgetCard title="Top apps & websites" description="Hours today, colored by productivity category" icon={AppWindow} className="xl:col-span-2">
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError && !q.data ? <ErrorState compact error={q.error} onRetry={() => q.refetch()} /> : <TopAppsChart apps={q.data?.topApps ?? []} />}
    </WidgetCard>
  );
}

export function LiveDashboard() {
  const qc = useQueryClient();
  const [departmentId, setDepartmentId] = React.useState<string | undefined>();
  const fetching = useIsFetching({ queryKey: ["workforce"] }) > 0;
  const summary = useWorkforceSummary({ departmentId });
  const updatedAt = summary.dataUpdatedAt ? new Date(summary.dataUpdatedAt).toISOString() : null;

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <PageHeader
        className="mb-1"
        title="Workforce — Live"
        icon={UsersRound}
        description="Who is working right now, attendance and productivity for today. Refreshes every 30 seconds."
        actions={
          <>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {fetching ? (
                "Refreshing…"
              ) : updatedAt ? (
                <>
                  Updated <RelativeTime value={updatedAt} />
                </>
              ) : null}
            </span>
            <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
            <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ["workforce"] })} disabled={fetching} aria-label="Refresh workforce data">
              <RefreshCw className={fetching ? "animate-spin" : undefined} /> Refresh
            </Button>
          </>
        }
      />
      <KpiStrip departmentId={departmentId} />
      <LiveEmployees departmentId={departmentId} />
      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-5">
        <DepartmentBreakdown departmentId={departmentId} />
        <TopApps departmentId={departmentId} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Privacy: only application names and website domains are collected — never keystrokes, typed text, page content or full URLs.
      </p>
    </div>
  );
}
