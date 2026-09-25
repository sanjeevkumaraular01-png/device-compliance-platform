"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertCircle, PackageCheck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { StatusBadge } from "@/components/common/status-badges";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { formatDate, humanize } from "@/lib/format";
import { patchSeverityMeta, patchStateMeta } from "@/lib/status";
import { PATCH_SEVERITIES, PATCH_STATES, type PatchState, type PatchStatus } from "@/types/api";

const columns: ColumnDef<PatchStatus, unknown>[] = [
  {
    id: "patchId",
    accessorKey: "patchId",
    header: "Patch",
    enableHiding: false,
    meta: { label: "Patch ID" },
    cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.patchId}</span>,
  },
  {
    id: "title",
    accessorKey: "title",
    header: "Title",
    meta: { label: "Title", className: "min-w-[220px] max-w-[380px]" },
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate" title={row.original.title}>
          {row.original.title}
        </div>
        {row.original.product && <div className="truncate text-[11px] text-muted-foreground">{row.original.product}</div>}
      </div>
    ),
  },
  {
    id: "severity",
    accessorKey: "severity",
    header: "Severity",
    meta: { label: "Severity" },
    cell: ({ row }) => <StatusBadge value={row.original.severity} meta={patchSeverityMeta} />,
  },
  {
    id: "state",
    accessorKey: "state",
    header: "State",
    meta: { label: "State" },
    cell: ({ row }) => {
      const p = row.original;
      const badge = <StatusBadge value={p.state} meta={patchStateMeta} />;
      if (!p.lastError) return badge;
      return (
        <SimpleTooltip label={<span className="break-words">{p.lastError}</span>}>
          <span className="inline-flex cursor-help items-center gap-1" tabIndex={0} aria-label={`Last error: ${p.lastError}`}>
            {badge}
            <AlertCircle className="size-3.5 text-sev-critical" />
          </span>
        </SimpleTooltip>
      );
    },
  },
  {
    id: "category",
    accessorKey: "category",
    header: "Category",
    meta: { label: "Category" },
    cell: ({ row }) => <span className="text-xs">{humanize(row.original.category)}</span>,
  },
  {
    id: "cveIds",
    header: "CVEs",
    enableSorting: false,
    meta: { label: "CVEs" },
    cell: ({ row }) => {
      const cves = row.original.cveIds ?? [];
      if (cves.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="whitespace-nowrap font-mono text-[11px]" title={cves.join(", ")}>
          {cves.slice(0, 2).join(", ")}
          {cves.length > 2 && <span className="text-muted-foreground"> +{cves.length - 2}</span>}
          {row.original.cvssScore != null && <span className="ml-1.5 text-muted-foreground">CVSS {row.original.cvssScore}</span>}
        </span>
      );
    },
  },
  {
    id: "releasedAt",
    accessorKey: "releasedAt",
    header: "Released",
    meta: { label: "Released" },
    cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.releasedAt)}</span>,
  },
  {
    id: "installedAt",
    accessorKey: "installedAt",
    header: "Installed",
    meta: { label: "Installed" },
    cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.installedAt)}</span>,
  },
];

export function PatchesTab({ deviceId, initialState }: { deviceId: string; initialState?: PatchState }) {
  const list = useListQuery<PatchStatus>(["devices", deviceId, "patches"], `/devices/${deviceId}/patches`, {
    initial: { filters: initialState ? { state: initialState } : {} },
  });
  const f = list.state.filters;

  return (
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
      maxHeight="max(22rem, calc(100dvh - 22rem))"
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search KB, title, CVE…" }}
      filters={
        <>
          <FilterSelect
            label="State"
            value={f.state === undefined ? undefined : String(f.state)}
            onChange={(v) => list.setFilter("state", v)}
            options={enumOptions(PATCH_STATES, (s) => patchStateMeta[s].label)}
          />
          <FilterSelect
            label="Severity"
            value={f.severity === undefined ? undefined : String(f.severity)}
            onChange={(v) => list.setFilter("severity", v)}
            options={enumOptions(PATCH_SEVERITIES, (s) => patchSeverityMeta[s].label)}
          />
          <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
        </>
      }
      rowClassName={(r) => (r.state === "FAILED" ? "bg-sev-critical/5" : undefined)}
      empty={{ icon: PackageCheck, title: list.activeFilterCount || list.state.search ? "No matching patches" : "No patch data reported yet" }}
    />
  );
}
