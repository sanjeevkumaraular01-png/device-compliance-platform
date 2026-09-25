"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { BellOff, Check, CheckCheck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { SeverityBadge, StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { Button } from "@/components/ui/button";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { alertSeverityMeta, alertStatusMeta } from "@/lib/status";
import { formatDateTime, formatNumber, humanize } from "@/lib/format";
import { AlertDetailSheet } from "@/components/alerts/alert-detail-sheet";
import { ALERT_CATEGORIES, ALERT_SEVERITIES, ALERT_STATUSES, type Alert } from "@/types/api";

const SEVERITY_DESC = [...ALERT_SEVERITIES].reverse();

export function AlertsTab() {
  const { can } = useAuth();
  const canWrite = can("alerts:write");
  const list = useListQuery<Alert>("alerts", "/alerts", {
    initial: { sortBy: "lastOccurredAt", sortOrder: "desc", filters: { status: "OPEN" } },
    refetchInterval: 30_000,
  });
  const [openId, setOpenId] = React.useState<string | null>(null);

  const bulk = useApiMutation((v: { ids: string[]; action: "acknowledge" | "resolve" }) => api.post("/alerts/bulk", v), {
    success: (_d, v) => `${formatNumber(v.ids.length)} alert${v.ids.length === 1 ? "" : "s"} ${v.action === "acknowledge" ? "acknowledged" : "resolved"}`,
    invalidate: [["alerts"], ["dashboard"]],
  });

  const columns = React.useMemo<ColumnDef<Alert, unknown>[]>(
    () => [
      {
        id: "severity",
        header: "Severity",
        meta: { label: "Severity" },
        cell: ({ row }) => <SeverityBadge value={row.original.severity} />,
      },
      {
        id: "title",
        header: "Alert",
        meta: { label: "Alert" },
        cell: ({ row }) => (
          <div className="min-w-[220px] max-w-[440px]">
            <div className="truncate font-medium" title={row.original.title}>
              {row.original.title}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={row.original.message}>
              {row.original.message}
            </div>
          </div>
        ),
      },
      {
        id: "category",
        header: "Category",
        meta: { label: "Category" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{humanize(row.original.category)}</span>,
      },
      {
        id: "device",
        header: "Endpoint",
        enableSorting: false,
        meta: { label: "Endpoint" },
        cell: ({ row }) =>
          row.original.deviceId ? (
            <Link
              href={`/devices/${row.original.deviceId}`}
              onClick={(e) => e.stopPropagation()}
              className="whitespace-nowrap font-medium hover:text-primary hover:underline"
            >
              {row.original.device?.deviceName ?? row.original.deviceId.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "occurrences",
        header: "Count",
        meta: { label: "Occurrences", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => (row.original.occurrences > 1 ? <span className="font-medium">×{formatNumber(row.original.occurrences)}</span> : "1"),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <StatusBadge value={row.original.status} meta={alertStatusMeta} />,
      },
      {
        id: "lastOccurredAt",
        header: "Last seen",
        meta: { label: "Last occurred" },
        cell: ({ row }) => <RelativeTime value={row.original.lastOccurredAt} className="text-xs" />,
      },
      {
        id: "createdAt",
        header: "Created",
        meta: { label: "Created" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={list.rows}
        meta={list.meta}
        loading={list.query.isLoading}
        fetching={list.query.isFetching}
        error={list.query.error}
        onRetry={() => list.query.refetch()}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        sortBy={list.state.sortBy}
        sortOrder={list.state.sortOrder}
        onSortChange={list.setSort}
        getRowId={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        rowClassName={(r) => (r.status === "OPEN" && r.severity === "CRITICAL" ? "bg-sev-critical/5" : undefined)}
        enableSelection={canWrite}
        bulkActions={(selected, clear) => {
          const ids = selected.map((s) => s.id);
          const ackIds = selected.filter((s) => s.status === "OPEN").map((s) => s.id);
          const resolveIds = selected.filter((s) => s.status !== "RESOLVED").map((s) => s.id);
          return (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={ackIds.length === 0 || bulk.isPending}
                loading={bulk.isPending && bulk.variables?.action === "acknowledge"}
                onClick={() => bulk.mutate({ ids: ackIds, action: "acknowledge" }, { onSuccess: clear })}
              >
                <Check /> Acknowledge{ackIds.length !== ids.length && ackIds.length > 0 ? ` (${ackIds.length})` : ""}
              </Button>
              <Button
                size="xs"
                disabled={resolveIds.length === 0 || bulk.isPending}
                loading={bulk.isPending && bulk.variables?.action === "resolve"}
                onClick={() => bulk.mutate({ ids: resolveIds, action: "resolve" }, { onSuccess: clear })}
              >
                <CheckCheck /> Resolve{resolveIds.length !== ids.length && resolveIds.length > 0 ? ` (${resolveIds.length})` : ""}
              </Button>
            </>
          );
        }}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search alerts…" }}
        filters={
          <>
            <FilterSelect
              label="Status"
              value={list.state.filters.status as string | undefined}
              onChange={(v) => list.setFilter("status", v)}
              options={enumOptions(ALERT_STATUSES, (v) => alertStatusMeta[v].label)}
            />
            <FilterSelect
              label="Severity"
              value={list.state.filters.severity as string | undefined}
              onChange={(v) => list.setFilter("severity", v)}
              options={enumOptions(SEVERITY_DESC, (v) => alertSeverityMeta[v].label)}
            />
            <FilterSelect
              label="Category"
              value={list.state.filters.category as string | undefined}
              onChange={(v) => list.setFilter("category", v)}
              options={enumOptions(ALERT_CATEGORIES, humanize)}
            />
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        empty={{
          icon: BellOff,
          title: list.state.filters.status === "OPEN" ? "No open alerts" : "No alerts",
          description: list.state.filters.status === "OPEN" ? "Everything is quiet. New alerts appear here automatically." : "No alerts match the current filters.",
        }}
      />
      <AlertDetailSheet alertId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </>
  );
}
