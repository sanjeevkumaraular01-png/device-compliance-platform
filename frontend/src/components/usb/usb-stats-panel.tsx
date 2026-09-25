"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Percent, ShieldBan, ShieldX, Usb } from "lucide-react";
import { api } from "@/lib/api";
import { toneColor } from "@/lib/status";
import { formatDate, formatNumber } from "@/lib/format";
import { KpiCard } from "@/components/common/kpi-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { SimpleBarChart } from "@/components/charts/charts";
import { DeviceLink } from "@/components/usb/usb-utils";
import type { UsbStats } from "@/types/api";

export function UsbStatsPanel() {
  const stats = useQuery({
    queryKey: ["usb", "stats"],
    queryFn: () => api.get<UsbStats>("/usb/stats"),
    refetchInterval: 60_000,
  });
  const s = stats.data;
  const total7d = (s?.blocked7d ?? 0) + (s?.allowed7d ?? 0);
  const blockRate = total7d > 0 ? ((s?.blocked7d ?? 0) / total7d) * 100 : 0;
  const maxBlocked = Math.max(1, ...(s?.topDevices ?? []).map((d) => d.blocked));

  if (stats.isError) {
    return (
      <Card>
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} compact />
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Blocked · last 24h" value={formatNumber(s?.blocked24h)} icon={ShieldBan} tone="critical" loading={stats.isLoading} sub="Removable media denied by policy" />
        <KpiCard label="Blocked · last 7 days" value={formatNumber(s?.blocked7d)} icon={ShieldX} tone="high" loading={stats.isLoading} sub="Across all managed endpoints" />
        <KpiCard label="Allowed · last 7 days" value={formatNumber(s?.allowed7d)} icon={CheckCircle2} tone="success" loading={stats.isLoading} sub="Whitelisted or approved access" />
        <KpiCard
          label="Block rate · 7 days"
          value={total7d > 0 ? `${blockRate.toFixed(1)}%` : "—"}
          icon={Percent}
          tone={blockRate > 50 ? "medium" : "neutral"}
          loading={stats.isLoading}
          sub={`${formatNumber(total7d)} policy decisions`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>USB activity by day</CardTitle>
            <CardDescription>Blocked vs. allowed connection attempts</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (s?.byDay.length ?? 0) === 0 ? (
              <EmptyState compact icon={Usb} title="No USB activity recorded" description="Events appear here as agents report device connections." />
            ) : (
              <SimpleBarChart
                data={s?.byDay ?? []}
                xKey="date"
                stacked
                height={220}
                xFormatter={(v) => formatDate(v, "MMM d")}
                series={[
                  { key: "blocked", label: "Blocked", color: toneColor.critical },
                  { key: "allowed", label: "Allowed", color: toneColor.success },
                ]}
              />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Top endpoints by blocked attempts</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? (
              <div className="grid gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : (s?.topDevices.length ?? 0) === 0 ? (
              <EmptyState compact icon={ShieldBan} title="No blocked attempts" description="No endpoint had USB devices blocked in the last 7 days." />
            ) : (
              <ol className="grid gap-2.5">
                {s?.topDevices.map((d, i) => (
                  <li key={d.deviceId} className="grid gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-4 shrink-0 text-xs tabular text-muted-foreground">{i + 1}</span>
                      <DeviceLink id={d.deviceId} name={d.deviceName} className="min-w-0 truncate" />
                      <span className="ml-auto shrink-0 text-xs font-medium tabular text-sev-critical">{formatNumber(d.blocked)}</span>
                    </div>
                    <div className="ml-6 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-sev-critical/70" style={{ width: `${(d.blocked / maxBlocked) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
