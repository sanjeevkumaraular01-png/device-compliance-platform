"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Building2, ClipboardList, Layers, ShieldAlert, TrendingDown, TrendingUp, Wifi } from "lucide-react";
import { AreaTrendChart, CHART_COLORS, DonutChart, SimpleBarChart } from "@/components/charts/charts";
import { EmptyState, ErrorState } from "@/components/common/states";
import { OsIcon } from "@/components/common/os-icon";
import { SeverityBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WidgetCard } from "@/components/dashboard/widget-card";
import {
  useComplianceTrend,
  useDashboardSummary,
  useDepartmentCompliance,
  useRecentAlerts,
  useTopViolations,
} from "@/components/dashboard/queries";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber, formatPercent, humanize, pct, platformLabel } from "@/lib/format";
import { RISK_ORDER, rateTone, riskMeta, toneColor, toneDot, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { OsPlatform } from "@/types/api";

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Button asChild variant="ghost" size="xs" className="text-muted-foreground">
      <Link href={href}>
        {label} <ArrowRight />
      </Link>
    </Button>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-3 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────── Compliance trend ───────────────────────────────

const TREND_RANGES = [7, 30, 90] as const;

export function ComplianceTrendWidget({ className }: { className?: string }) {
  const [days, setDays] = React.useState<number>(30);
  const q = useComplianceTrend(days);
  const data = q.data ?? [];
  const last = data.at(-1);
  const first = data[0];
  const delta = last && first ? last.complianceRate - first.complianceRate : 0;

  return (
    <WidgetCard
      className={className}
      title="Compliance trend"
      description={`Fleet compliance rate and average score over the last ${days} days`}
      action={
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <TabsList variant="pill" aria-label="Trend range">
            {TREND_RANGES.map((d) => (
              <TabsTrigger key={d} value={String(d)}>
                {d}d
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : data.length === 0 ? (
        <EmptyState compact icon={TrendingUp} title="No trend data yet" description="Compliance history appears once devices have been evaluated." />
      ) : (
        <div className={cn("grid gap-3 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
          {last && (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current rate</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular">{formatPercent(last.complianceRate)}</span>
                  {data.length > 1 && (
                    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", delta >= 0 ? toneText.success : toneText.critical)}>
                      {delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                      {delta >= 0 ? "+" : ""}
                      {delta.toFixed(1)} pts
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Avg. score</div>
                <div className="text-2xl font-semibold tabular">{formatNumber(last.averageScore)}</div>
              </div>
            </div>
          )}
          <AreaTrendChart
            data={data.map((p) => ({ date: p.date, complianceRate: p.complianceRate, averageScore: p.averageScore }))}
            xKey="date"
            height={230}
            yDomain={[0, 100]}
            xFormatter={(v) => formatDate(v, "MMM d")}
            valueFormatter={(v, name) => (name === "Compliance rate" ? formatPercent(v) : formatNumber(v, 1))}
            series={[
              { key: "complianceRate", label: "Compliance rate", color: CHART_COLORS[0] },
              { key: "averageScore", label: "Average score", color: CHART_COLORS[1] },
            ]}
          />
        </div>
      )}
    </WidgetCard>
  );
}

// ─────────────────────────────── Online devices + open alerts ───────────────────────────────

export function OnlineDevicesWidget({ className }: { className?: string }) {
  const { can } = useAuth();
  const q = useDashboardSummary();
  const s = q.data;
  const onlineRate = s ? pct(s.onlineDevices, s.totalDevices) : 0;

  return (
    <WidgetCard className={className} icon={Wifi} title="Connectivity & alerts" description="Agents checked in within the last 15 minutes">
      {q.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : q.isError || !s ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tabular">{formatNumber(s.onlineDevices)}</span>
              <span className="text-sm text-muted-foreground tabular">/ {formatNumber(s.totalDevices)} online</span>
              <span className="ml-auto text-sm font-medium tabular">{formatPercent(onlineRate)}</span>
            </div>
            <Progress value={onlineRate} tone="success" aria-label="Devices online" />
            <p className="text-xs text-muted-foreground">
              {formatNumber(Math.max(0, s.totalDevices - s.onlineDevices))} devices offline or not reporting
            </p>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Bell className="size-3.5" /> Open alerts
              </span>
              {can("alerts:read") && <ViewAll href="/alerts" label="Alerts" />}
            </div>
            <div className="grid grid-cols-3 divide-x rounded-md border">
              {[
                { label: "Total", value: s.openAlerts.total, cls: "" },
                { label: "Critical", value: s.openAlerts.critical, cls: s.openAlerts.critical > 0 ? toneText.critical : "" },
                { label: "High", value: s.openAlerts.high, cls: s.openAlerts.high > 0 ? toneText.high : "" },
              ].map((x) => (
                <div key={x.label} className="px-3 py-2">
                  <div className={cn("text-lg font-semibold tabular", x.cls)}>{formatNumber(x.value)}</div>
                  <div className="text-[11px] text-muted-foreground">{x.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

// ─────────────────────────────── Platform donut ───────────────────────────────

const PLATFORM_COLORS: Record<OsPlatform, string> = {
  WINDOWS: CHART_COLORS[0],
  LINUX: CHART_COLORS[3],
  MACOS: CHART_COLORS[2],
};

export function PlatformWidget({ className }: { className?: string }) {
  const q = useDashboardSummary();
  const rows = q.data?.byPlatform ?? [];
  return (
    <WidgetCard className={className} icon={Layers} title="Devices by platform">
      {q.isLoading ? (
        <Skeleton className="mx-auto size-[150px] rounded-full" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact title="No devices enrolled" />
      ) : (
        <div className="grid gap-3">
          <DonutChart
            height={150}
            centerLabel="devices"
            data={rows.map((r) => ({
              name: platformLabel[r.platform] ?? r.platform,
              value: r.count,
              color: PLATFORM_COLORS[r.platform] ?? CHART_COLORS[4],
            }))}
          />
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {rows.map((r) => (
              <span key={r.platform} className="inline-flex items-center gap-1.5">
                <OsIcon platform={r.platform} className="size-3.5" />
                {platformLabel[r.platform] ?? r.platform}
              </span>
            ))}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

// ─────────────────────────────── Risk distribution ───────────────────────────────

export function RiskDistributionWidget({ className }: { className?: string }) {
  const q = useDashboardSummary();
  const data = React.useMemo(() => {
    const byRisk = q.data?.byRisk ?? [];
    return RISK_ORDER.map((r) => ({
      risk: riskMeta[r].label,
      level: r,
      Devices: byRisk.find((x) => x.riskLevel === r)?.count ?? 0,
    }));
  }, [q.data]);
  const total = data.reduce((a, d) => a + d.Devices, 0);

  return (
    <WidgetCard className={className} icon={ShieldAlert} title="Risk distribution" description="Devices by current risk level">
      {q.isLoading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : total === 0 ? (
        <EmptyState compact title="No risk data yet" />
      ) : (
        <SimpleBarChart
          data={data}
          xKey="risk"
          height={200}
          series={[{ key: "Devices", label: "Devices", color: "var(--chart-1)" }]}
          colorByDatum={(d) => toneColor[riskMeta[d.level].tone]}
          showLegend={false}
        />
      )}
    </WidgetCard>
  );
}

// ─────────────────────────────── Top violations ───────────────────────────────

export function TopViolationsWidget({ className }: { className?: string }) {
  const { can } = useAuth();
  const q = useTopViolations(5);
  const summary = useDashboardSummary();
  const rows = q.data ?? [];
  const max = Math.max(1, summary.data?.totalDevices ?? 0, ...rows.map((r) => r.deviceCount));

  return (
    <WidgetCard
      className={className}
      icon={ClipboardList}
      title="Top violations"
      description="Most frequently failing compliance rules"
      action={can("compliance:read") ? <ViewAll href="/compliance" /> : undefined}
    >
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={ClipboardList} title="No failing rules" description="All evaluated devices pass every compliance rule." />
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.ruleKey} className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <SeverityBadge value={r.severity} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm" title={r.name}>
                  {r.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular">
                  <span className="font-medium text-foreground">{formatNumber(r.deviceCount)}</span> devices
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", toneDot[riskMeta[r.severity]?.tone ?? "unknown"])}
                  style={{ width: `${Math.max(2, (r.deviceCount / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ─────────────────────────────── Department compliance ───────────────────────────────

export function DepartmentComplianceWidget({ className }: { className?: string }) {
  const q = useDepartmentCompliance();
  const rows = React.useMemo(() => [...(q.data ?? [])].sort((a, b) => a.complianceRate - b.complianceRate), [q.data]);

  return (
    <WidgetCard
      className={className}
      icon={Building2}
      title="Compliance by department"
      description="Sorted by lowest compliance first"
      contentClassName="px-0 pb-0"
    >
      {q.isLoading ? (
        <div className="px-4 pb-4">
          <ListSkeleton rows={6} />
        </div>
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={Building2} title="No departments" description="Assign devices to departments to compare compliance." />
      ) : (
        <Table containerClassName="max-h-[340px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Department</TableHead>
              <TableHead className="text-right">Devices</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Compliant</TableHead>
              <TableHead className="w-[40%] min-w-[140px] pr-4">Compliance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => {
              const tone = rateTone(d.complianceRate);
              return (
                <TableRow key={d.departmentId}>
                  <TableCell className="max-w-[180px] truncate pl-4 font-medium">{d.departmentName}</TableCell>
                  <TableCell className="text-right tabular">{formatNumber(d.total)}</TableCell>
                  <TableCell className="hidden text-right tabular sm:table-cell">{formatNumber(d.compliant)}</TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center gap-2">
                      <Progress value={d.complianceRate} tone={tone} className="flex-1" aria-label={`${d.departmentName} compliance`} />
                      <span className={cn("w-12 text-right text-xs font-medium tabular", toneText[tone])}>{formatPercent(d.complianceRate)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </WidgetCard>
  );
}

// ─────────────────────────────── Recent alerts ───────────────────────────────

export function RecentAlertsWidget({ className }: { className?: string }) {
  const { can } = useAuth();
  const q = useRecentAlerts(10);
  const rows = q.data ?? [];
  const canAlerts = can("alerts:read");
  const canDevices = can("devices:read");

  return (
    <WidgetCard
      className={className}
      icon={AlertTriangle}
      title="Recent alerts"
      description="Latest events raised across the fleet"
      action={canAlerts ? <ViewAll href="/alerts" /> : undefined}
      contentClassName="px-0 pb-0"
    >
      {q.isLoading ? (
        <div className="px-4 pb-4">
          <ListSkeleton rows={6} />
        </div>
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={Bell} title="No recent alerts" description="You're all caught up." />
      ) : (
        <ul className="max-h-[340px] divide-y overflow-y-auto scrollbar-thin border-t">
          {rows.map((a) => {
            const body = (
              <div className="flex items-start gap-3 px-4 py-2.5">
                <SeverityBadge value={a.severity} className="mt-0.5 w-[72px] shrink-0 justify-center" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={a.title}>
                    {a.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.device?.deviceName ? <>{a.device.deviceName} · </> : null}
                    {humanize(a.category)}
                    {a.occurrences > 1 && <> · ×{a.occurrences}</>}
                  </p>
                </div>
                <RelativeTime value={a.lastOccurredAt ?? a.createdAt} className="shrink-0 pt-0.5 text-xs text-muted-foreground" />
              </div>
            );
            return (
              <li key={a.id}>
                {canAlerts ? (
                  <Link href="/alerts" className="block transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none">
                    {body}
                  </Link>
                ) : canDevices && a.deviceId ? (
                  <Link href={`/devices/${a.deviceId}`} className="block transition-colors hover:bg-accent/40 focus-visible:outline-none">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
