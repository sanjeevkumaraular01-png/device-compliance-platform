"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { COMPLIANCE_STATES, type ComplianceSummary } from "@/types/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DonutChart, SimpleBarChart } from "@/components/charts/charts";
import { EmptyState, ErrorState } from "@/components/common/states";
import { RISK_ORDER, complianceMeta, riskMeta, toneColor } from "@/lib/status";
import { formatPercent, pct } from "@/lib/format";

export function useComplianceSummary() {
  return useQuery({
    queryKey: ["compliance", "summary"],
    queryFn: ({ signal }) => api.get<ComplianceSummary>("/compliance/summary", undefined, { signal }),
    refetchInterval: 60_000,
  });
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ChartCard({ title, description, className, children }: { title: string; description?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ComplianceSummaryCharts() {
  const q = useComplianceSummary();

  if (q.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="mb-4 h-3.5 w-32" />
              <Skeleton className="h-44 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} compact />
      </Card>
    );
  }

  const { byState, byRisk, byRule } = q.data;
  const stateCount = (s: string) => byState.find((x) => x.state === s)?.count ?? 0;
  const total = byState.reduce((a, s) => a + s.count, 0);
  const compliant = stateCount("COMPLIANT");

  const donut = COMPLIANCE_STATES.map((s) => ({ name: complianceMeta[s].label, value: stateCount(s), color: toneColor[complianceMeta[s].tone] }));

  const riskData = [...RISK_ORDER].reverse().map((r) => ({
    risk: riskMeta[r].label,
    level: r,
    devices: byRisk.find((x) => x.riskLevel === r)?.count ?? 0,
  }));

  const ruleData = byRule
    .filter((r) => r.failing > 0)
    .sort((a, b) => b.failing - a.failing)
    .slice(0, 10)
    .map((r) => ({ name: r.name, ruleKey: r.ruleKey, severity: r.severity, failing: r.failing }));

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <ChartCard title="Compliance state" description="Latest evaluation of every managed device.">
        <DonutChart data={donut} height={170} centerValue={total ? formatPercent(pct(compliant, total), 0) : "—"} centerLabel="compliant" />
      </ChartCard>

      <ChartCard title="Risk distribution" description="Highest severity among each device’s failed rules.">
        <SimpleBarChart
          data={riskData}
          xKey="risk"
          series={[{ key: "devices", label: "Devices", color: "var(--chart-1)" }]}
          colorByDatum={(d) => toneColor[riskMeta[d.level].tone]}
          height={190}
          showLegend={false}
        />
      </ChartCard>

      <ChartCard title="Failing devices by rule" description="Top rules by number of devices failing them." className="lg:col-span-2 xl:col-span-1">
        {ruleData.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No failing rules" description="Every evaluated device passes all enabled rules." compact />
        ) : (
          <SimpleBarChart
            data={ruleData}
            xKey="name"
            layout="vertical"
            series={[{ key: "failing", label: "Failing devices", color: "var(--chart-1)" }]}
            colorByDatum={(d) => toneColor[riskMeta[d.severity].tone]}
            height={Math.max(170, ruleData.length * 28 + 24)}
            yWidth={132}
            xFormatter={(v) => truncate(v, 20)}
            barSize={16}
            showLegend={false}
          />
        )}
      </ChartCard>
    </div>
  );
}
