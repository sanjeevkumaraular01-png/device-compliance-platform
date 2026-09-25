"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, ClipboardCheck, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplianceBadge, RiskBadge, SeverityBadge } from "@/components/common/status-badges";
import { ScoreRing } from "@/components/common/score-ring";
import { RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { AreaTrendChart } from "@/components/charts/charts";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { RISK_ORDER, riskMeta, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ComplianceFinding, ComplianceResult, DeviceDetail, Paginated } from "@/types/api";

function sortFindings(findings: ComplianceFinding[]): ComplianceFinding[] {
  return [...findings].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    const sa = RISK_ORDER.indexOf(a.severity);
    const sb = RISK_ORDER.indexOf(b.severity);
    if (sa !== sb) return sa - sb;
    return b.weight - a.weight;
  });
}

export function ComplianceTab({ device }: { device: DeviceDetail }) {
  const q = useQuery({
    queryKey: ["devices", device.id, "compliance"],
    queryFn: async () => normalizeList(await api.get<Paginated<ComplianceResult> | ComplianceResult[]>(`/devices/${device.id}/compliance`)).data,
  });

  const results = React.useMemo(() => [...(q.data ?? [])].sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt)), [q.data]);
  const latest = results[0] ?? device.latestCompliance ?? null;
  const history = React.useMemo(
    () => [...results].reverse().map((r) => ({ evaluatedAt: r.evaluatedAt, score: r.score })),
    [results],
  );

  if (q.isLoading) {
    return (
      <Card>
        <TableSkeleton rows={6} cols={4} />
      </Card>
    );
  }
  if (q.isError && !latest) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!latest) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardCheck}
          title="Not evaluated yet"
          description="Compliance is evaluated after the agent's first inventory report, or run an evaluation now from the header."
        />
      </Card>
    );
  }

  const findings = sortFindings(latest.findings ?? []);
  const failed = findings.filter((f) => !f.passed);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Latest evaluation</CardTitle>
          <CardDescription>
            {formatDateTime(latest.evaluatedAt)}
            {latest.policyVersion != null ? ` · policy v${latest.policyVersion}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={latest.state === "UNKNOWN" ? null : latest.score} size={76} stroke={6} />
            <div className="grid gap-1.5">
              <ComplianceBadge value={latest.state} />
              <RiskBadge value={latest.riskLevel} />
              <span className="text-xs text-muted-foreground">
                {failed.length} of {findings.length} checks failing
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {(
              [
                ["CRITICAL", latest.criticalCount],
                ["HIGH", latest.highCount],
                ["MEDIUM", latest.mediumCount],
                ["LOW", latest.lowCount],
              ] as const
            ).map(([sev, count]) => (
              <div key={sev} className="rounded-md border px-1 py-2">
                <div className={cn("text-lg font-semibold tabular", count > 0 ? toneText[riskMeta[sev].tone] : "text-muted-foreground")}>{count}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{riskMeta[sev].label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Score history</CardTitle>
          <CardDescription>Last {results.length} evaluations</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length >= 2 ? (
            <AreaTrendChart
              data={history}
              xKey="evaluatedAt"
              series={[{ key: "score", label: "Score", color: "var(--chart-1)" }]}
              height={200}
              yDomain={[0, 100]}
              xFormatter={(v) => formatDate(v, "MMM d")}
              valueFormatter={(v) => `${v}`}
            />
          ) : (
            <EmptyState compact title="Not enough history" description="The trend appears after two or more evaluations." className="py-12" />
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Findings</CardTitle>
            <CardDescription className="mt-1">Failed checks first, ordered by severity. Score = 100 − Σ weight of failed rules.</CardDescription>
          </div>
          <span className="text-xs text-muted-foreground">
            Evaluated <RelativeTime value={latest.evaluatedAt} />
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {findings.length === 0 ? (
            <EmptyState compact title="No rules evaluated" />
          ) : (
            <ul className="divide-y border-t">
              {findings.map((f) => (
                <li key={f.ruleKey} className={cn("flex gap-3 px-4 py-3", !f.passed && f.severity === "CRITICAL" && "bg-sev-critical/5")}>
                  {f.passed ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-sev-none" aria-label="Passed" />
                  ) : (
                    <CircleX className={cn("mt-0.5 size-4 shrink-0", toneText[riskMeta[f.severity]?.tone ?? "critical"])} aria-label="Failed" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("text-sm font-medium", f.passed && "text-muted-foreground")}>{f.name}</span>
                      <SeverityBadge value={f.severity} />
                      {!f.passed && f.markNonCompliant && <Badge tone="critical">Non-compliant</Badge>}
                      <span className="font-mono text-[10px] text-muted-foreground">{f.ruleKey}</span>
                      <span className={cn("ml-auto text-xs tabular", f.passed ? "text-muted-foreground" : "font-medium text-foreground")}>
                        {f.passed ? `${f.weight} pts` : `−${f.weight} pts`}
                      </span>
                    </div>
                    {f.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{f.detail}</p>}
                    {!f.passed && f.remediation && (
                      <p className="mt-1.5 flex items-start gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                        <Wrench className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                        <span className="break-words">{f.remediation}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
