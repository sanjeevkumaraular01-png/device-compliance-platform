"use client";

import * as React from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/misc";
import { Button } from "@/components/ui/button";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { useDashboardSummary } from "@/components/dashboard/queries";
import {
  ComplianceTrendWidget,
  DepartmentComplianceWidget,
  OnlineDevicesWidget,
  PlatformWidget,
  RecentAlertsWidget,
  RiskDistributionWidget,
  TopViolationsWidget,
} from "@/components/dashboard/widgets";
import { formatNumber } from "@/lib/format";

export function AdminDashboard() {
  const qc = useQueryClient();
  const summary = useDashboardSummary();
  const fetching = useIsFetching({ queryKey: ["dashboard"] }) > 0;
  const updatedAt = summary.dataUpdatedAt ? new Date(summary.dataUpdatedAt).toISOString() : null;

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        className="mb-1"
        title="Dashboard"
        icon={LayoutDashboard}
        description={
          summary.data
            ? `Security and compliance posture across ${formatNumber(summary.data.totalDevices)} managed devices`
            : "Security and compliance posture across your managed devices"
        }
        actions={
          <>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {fetching ? (
                "Refreshing…"
              ) : updatedAt ? (
                <>
                  Last updated <RelativeTime value={updatedAt} />
                </>
              ) : null}
            </span>
            <Button variant="outline" size="sm" onClick={refresh} disabled={fetching} aria-label="Refresh dashboard">
              <RefreshCw className={fetching ? "animate-spin" : undefined} /> Refresh
            </Button>
          </>
        }
      />

      <KpiGrid />

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <ComplianceTrendWidget className="xl:col-span-2" />
        <OnlineDevicesWidget />
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PlatformWidget />
        <RiskDistributionWidget />
        <TopViolationsWidget className="md:col-span-2 xl:col-span-1" />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-5">
        <DepartmentComplianceWidget className="xl:col-span-3" />
        <RecentAlertsWidget className="xl:col-span-2" />
      </div>
    </div>
  );
}
