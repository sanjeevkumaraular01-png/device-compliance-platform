"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PackageCheck, Rocket } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { SegmentBar } from "@/components/common/kpi-card";
import { StatusBadge } from "@/components/common/status-badges";
import { Mono } from "@/components/common/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { formatNumber, formatPercent, humanize, pct } from "@/lib/format";
import { patchSeverityMeta, patchStateMeta, rateTone, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import { PATCH_CATEGORIES, PATCH_SEVERITIES, PATCH_STATES, type PatchAggregate } from "@/types/api";

const severityOptions = enumOptions(PATCH_SEVERITIES, (s) => patchSeverityMeta[s].label);
const stateOptions = enumOptions(PATCH_STATES, (s) => patchStateMeta[s].label);
const categoryOptions = enumOptions(PATCH_CATEGORIES, (c) => (c === "OS" ? "OS" : humanize(c)));

function CveList({ ids }: { ids: string[] }) {
  if (!ids?.length) return <span className="text-muted-foreground">—</span>;
  const shown = ids.slice(0, 2);
  const rest = ids.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((id) => (
        <Mono key={id} className="whitespace-nowrap rounded bg-muted px-1 py-px text-[11px]">
          {id}
        </Mono>
      ))}
      {rest.length > 0 && (
        <SimpleTooltip label={<span className="font-mono text-[11px]">{rest.join(", ")}</span>}>
          <Badge variant="outline" className="cursor-default">
            +{rest.length}
          </Badge>
        </SimpleTooltip>
      )}
    </div>
  );
}

export function PatchesTable({ canDeploy, onDeploy }: { canDeploy: boolean; onDeploy: (patchIds: string[]) => void }) {
  const list = useListQuery<PatchAggregate>("patches", "/patches", {
    initial: { sortBy: "missingCount", sortOrder: "desc" },
  });

  const columns = React.useMemo<ColumnDef<PatchAggregate, unknown>[]>(
    () => [
      {
        id: "patchId",
        accessorKey: "patchId",
        header: "Patch ID",
        enableHiding: false,
        meta: { label: "Patch ID" },
        cell: ({ row }) => <Mono className="whitespace-nowrap font-medium">{row.original.patchId}</Mono>,
      },
      {
        id: "title",
        accessorKey: "title",
        header: "Title",
        meta: { label: "Title", className: "min-w-[220px]" },
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-[380px]" title={row.original.title}>
            {row.original.title}
          </span>
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
        id: "category",
        accessorKey: "category",
        header: "Category",
        meta: { label: "Category" },
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.category === "OS" ? "OS" : humanize(row.original.category)}</span>,
      },
      {
        id: "cveIds",
        header: "CVEs",
        enableSorting: false,
        meta: { label: "CVEs" },
        cell: ({ row }) => <CveList ids={row.original.cveIds} />,
      },
      {
        id: "missingCount",
        accessorKey: "missingCount",
        header: "Missing",
        meta: { label: "Missing", className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => (
          <span className={cn("font-medium tabular", row.original.missingCount > 0 && toneText.high)}>{formatNumber(row.original.missingCount)}</span>
        ),
      },
      {
        id: "installedCount",
        accessorKey: "installedCount",
        header: "Installed",
        meta: { label: "Installed", className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => <span className="tabular">{formatNumber(row.original.installedCount)}</span>,
      },
      {
        id: "failedCount",
        accessorKey: "failedCount",
        header: "Failed",
        meta: { label: "Failed", className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => (
          <span className={cn("tabular", row.original.failedCount > 0 ? toneText.critical : "text-muted-foreground")}>
            {formatNumber(row.original.failedCount)}
          </span>
        ),
      },
      {
        id: "compliance",
        header: "Coverage",
        enableSorting: false,
        meta: { label: "Coverage", className: "min-w-[130px]" },
        cell: ({ row }) => {
          const r = row.original;
          const total = r.installedCount + r.missingCount + r.failedCount;
          const rate = pct(r.installedCount, total);
          return (
            <div className="flex items-center gap-2">
              <SegmentBar
                className="w-20"
                segments={[
                  { value: r.installedCount, tone: "success", label: "Installed" },
                  { value: r.missingCount, tone: "high", label: "Missing" },
                  { value: r.failedCount, tone: "critical", label: "Failed" },
                ]}
              />
              <span className={cn("w-11 text-right text-xs font-medium tabular", total ? toneText[rateTone(rate)] : "text-muted-foreground")}>
                {total ? formatPercent(rate, 0) : "—"}
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );

  const f = list.state.filters;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

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
      getRowId={(r) => r.patchId}
      enableSelection={canDeploy}
      bulkActions={
        canDeploy
          ? (selected, clear) => (
              <Button
                size="sm"
                onClick={() => {
                  onDeploy(selected.map((p) => p.patchId));
                  clear();
                }}
              >
                <Rocket /> Deploy selected
              </Button>
            )
          : undefined
      }
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search patch ID, title or CVE…" }}
      filters={
        <>
          <FilterSelect label="Severity" value={str(f.severity)} onChange={(v) => list.setFilter("severity", v)} options={severityOptions} />
          <FilterSelect label="State" value={str(f.state)} onChange={(v) => list.setFilter("state", v)} options={stateOptions} />
          <FilterSelect label="Category" value={str(f.category)} onChange={(v) => list.setFilter("category", v)} options={categoryOptions} />
          <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
        </>
      }
      empty={{
        icon: PackageCheck,
        title: list.activeFilterCount || list.state.search ? "No patches match these filters" : "No patch data yet",
        description:
          list.activeFilterCount || list.state.search
            ? "Try changing or clearing the filters."
            : "Patch status is collected from each agent's inventory report.",
      }}
    />
  );
}
