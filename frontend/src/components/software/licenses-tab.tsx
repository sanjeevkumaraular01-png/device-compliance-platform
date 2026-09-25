"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, FileKey2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatNumber, humanize } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { Paginated, SoftwareLicense } from "@/types/api";

const complianceTone: Record<SoftwareLicense["compliance"], Tone> = { OK: "success", OVER: "critical", EXPIRED: "medium" };
const complianceLabel: Record<SoftwareLicense["compliance"], string> = { OK: "Compliant", OVER: "Over-deployed", EXPIRED: "Expired" };

function utilization(l: SoftwareLicense): number | null {
  if (!l.licenseCount) return null;
  return (l.installed / l.licenseCount) * 100;
}

function utilTone(p: number): Tone {
  if (p > 100) return "critical";
  if (p >= 85) return "medium";
  return "success";
}

function totalCost(l: SoftwareLicense): number | null {
  const per = l.costPerSeat === null || l.costPerSeat === undefined || l.costPerSeat === "" ? null : Number(l.costPerSeat);
  if (per === null || !Number.isFinite(per)) return null;
  return per * (l.licenseCount ?? l.installed);
}

export function SoftwareLicensesTab() {
  const q = useQuery({
    queryKey: ["software", "licenses"],
    queryFn: async () => normalizeList(await api.get<Paginated<SoftwareLicense> | SoftwareLicense[]>("/software/licenses")).data,
  });
  const rows = React.useMemo(() => q.data ?? [], [q.data]);

  const summary = React.useMemo(() => {
    const over = rows.filter((r) => r.compliance === "OVER");
    const expired = rows.filter((r) => r.compliance === "EXPIRED");
    const spend = rows.reduce((sum, r) => sum + (totalCost(r) ?? 0), 0);
    const overSeats = over.reduce((sum, r) => sum + Math.max(0, r.installed - (r.licenseCount ?? 0)), 0);
    return { over, expired, spend, overSeats };
  }, [rows]);

  const columns = React.useMemo<ColumnDef<SoftwareLicense, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Software",
        meta: { label: "Software" },
        cell: ({ row }) => (
          <div className="min-w-[150px]">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.publisher || "—"}</div>
          </div>
        ),
      },
      {
        id: "licenseType",
        accessorKey: "licenseType",
        header: "Type",
        meta: { label: "License type" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.licenseType ? humanize(row.original.licenseType) : "—"}</span>,
      },
      {
        id: "utilization",
        accessorFn: (r) => utilization(r) ?? -1,
        header: "Utilization",
        meta: { label: "Utilization" },
        cell: ({ row }) => {
          const l = row.original;
          const p = utilization(l);
          return (
            <div className="w-40 min-w-[140px]">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="tabular">
                  {formatNumber(l.installed)} / {l.licenseCount !== null ? formatNumber(l.licenseCount) : "∞"}
                </span>
                {p !== null && <span className="tabular text-muted-foreground">{Math.round(p)}%</span>}
              </div>
              {p !== null ? <Progress value={Math.min(100, p)} tone={utilTone(p)} aria-label={`${Math.round(p)}% of licenses used`} /> : <Progress value={0} tone="neutral" />}
            </div>
          );
        },
      },
      {
        id: "available",
        accessorKey: "available",
        header: "Available",
        meta: { label: "Available", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) =>
          row.original.licenseCount === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={row.original.available < 0 ? "font-medium text-sev-critical" : undefined}>{formatNumber(row.original.available)}</span>
          ),
      },
      {
        id: "compliance",
        accessorKey: "compliance",
        header: "Compliance",
        meta: { label: "Compliance" },
        cell: ({ row }) => {
          const l = row.original;
          const over = Math.max(0, l.installed - (l.licenseCount ?? 0));
          return (
            <div className="whitespace-nowrap">
              <Badge tone={complianceTone[l.compliance]} dot>
                {complianceLabel[l.compliance] ?? l.compliance}
              </Badge>
              {l.compliance === "OVER" && over > 0 && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-sev-critical">
                  <AlertTriangle className="size-3" /> Over-licensed by {formatNumber(over)}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "licenseExpiresAt",
        accessorFn: (r) => r.licenseExpiresAt ?? "",
        header: "Expires",
        meta: { label: "Expiry" },
        cell: ({ row }) => (
          <span className={row.original.compliance === "EXPIRED" ? "whitespace-nowrap text-xs font-medium text-sev-medium" : "whitespace-nowrap text-xs"}>
            {formatDate(row.original.licenseExpiresAt)}
          </span>
        ),
      },
      {
        id: "costPerSeat",
        accessorFn: (r) => Number(r.costPerSeat ?? 0),
        header: "Cost / seat",
        meta: { label: "Cost per seat", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => formatCurrency(row.original.costPerSeat),
      },
      {
        id: "totalCost",
        accessorFn: (r) => totalCost(r) ?? 0,
        header: "Total cost",
        meta: { label: "Total cost", className: "text-right tabular font-medium", headerClassName: "text-right" },
        cell: ({ row }) => formatCurrency(totalCost(row.original)),
      },
    ],
    [],
  );

  return (
    <div className="grid gap-4">
      {summary.over.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-sev-critical/30 bg-sev-critical/8 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-sev-critical" />
          <div className="min-w-0">
            <div className="font-medium text-sev-critical">
              {summary.over.length} product{summary.over.length === 1 ? " is" : "s are"} deployed beyond purchased seats
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary.overSeats)} installation{summary.overSeats === 1 ? "" : "s"} over entitlement:{" "}
              {summary.over
                .slice(0, 4)
                .map((o) => o.name)
                .join(", ")}
              {summary.over.length > 4 ? ` and ${summary.over.length - 4} more` : ""}. Purchase additional seats or uninstall from unneeded endpoints.
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Tracked licenses" value={formatNumber(rows.length)} icon={FileKey2} loading={q.isLoading} />
        <KpiCard label="Over-deployed" value={formatNumber(summary.over.length)} tone={summary.over.length ? "critical" : "success"} loading={q.isLoading} sub={`${formatNumber(summary.overSeats)} seats short`} />
        <KpiCard label="Expired" value={formatNumber(summary.expired.length)} tone={summary.expired.length ? "medium" : "success"} loading={q.isLoading} sub="Renewal required" />
        <KpiCard label="License spend" value={formatCurrency(summary.spend)} loading={q.isLoading} sub="Seats × cost per seat" />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        getRowId={(r) => r.id}
        rowClassName={(r) => (r.compliance === "OVER" ? "bg-sev-critical/5" : undefined)}
        empty={{
          icon: FileKey2,
          title: "No licenses tracked",
          description: "Set a license type and seat count on entries in the Approved catalog to track license compliance.",
        }}
      />
    </div>
  );
}
