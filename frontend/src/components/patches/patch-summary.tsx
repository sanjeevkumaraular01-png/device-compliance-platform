"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2, PackageSearch } from "lucide-react";
import { api } from "@/lib/api";
import { KpiCard } from "@/components/common/kpi-card";
import { ErrorState } from "@/components/common/states";
import { SimpleBarChart } from "@/components/charts/charts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { formatNumber } from "@/lib/format";
import { patchSeverityMeta, toneColor } from "@/lib/status";
import { PATCH_SEVERITIES, type PatchSummary as PatchSummaryData } from "@/types/api";

export function PatchSummary() {
  const q = useQuery({
    queryKey: ["patches", "summary"],
    queryFn: () => api.get<PatchSummaryData>("/patches/summary"),
    refetchInterval: 60_000,
  });
  const s = q.data;
  const chartData = React.useMemo(
    () =>
      PATCH_SEVERITIES.map((sev) => ({
        severity: patchSeverityMeta[sev].label,
        key: sev,
        Missing: s?.bySeverity?.find((b) => b.severity === sev)?.missing ?? 0,
      })),
    [s],
  );

  if (q.isError && !s) {
    return (
      <Card>
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} title="Could not load patch summary" />
      </Card>
    );
  }

  const loading = q.isLoading || !s;
  const critical = s?.bySeverity?.find((b) => b.severity === "CRITICAL")?.missing ?? 0;

  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        label="Missing patches"
        icon={PackageSearch}
        tone={(s?.totalMissing ?? 0) > 0 ? "high" : "success"}
        loading={loading}
        value={formatNumber(s?.totalMissing)}
        sub={<>{formatNumber(critical)} rated critical</>}
      />
      <KpiCard
        label="Devices missing critical"
        icon={AlertOctagon}
        tone={(s?.devicesMissingCritical ?? 0) > 0 ? "critical" : "success"}
        loading={loading}
        value={formatNumber(s?.devicesMissingCritical)}
        sub="At least one critical update outstanding"
      />
      <KpiCard
        label="Fully patched devices"
        icon={CheckCircle2}
        tone="success"
        loading={loading}
        value={formatNumber(s?.devicesFullyPatched)}
        sub="No missing updates reported"
      />
      <WidgetCard title="Missing by severity" className="sm:col-span-3 lg:col-span-2" contentClassName="pt-0 pb-2">
        {loading ? (
          <Skeleton className="h-[130px] w-full" />
        ) : (
          <SimpleBarChart
            data={chartData}
            xKey="severity"
            height={130}
            barSize={28}
            series={[{ key: "Missing", label: "Missing", color: "var(--chart-1)" }]}
            colorByDatum={(d) => toneColor[patchSeverityMeta[d.key].tone]}
            showLegend={false}
          />
        )}
      </WidgetCard>
    </div>
  );
}
