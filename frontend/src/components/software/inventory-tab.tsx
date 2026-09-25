"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Package } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { StatusBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { useListQuery } from "@/hooks/use-list-query";
import { softwareStatusMeta } from "@/lib/status";
import { formatNumber, platformLabel } from "@/lib/format";
import { InventoryDevicesSheet } from "@/components/software/inventory-devices-sheet";
import { OS_PLATFORMS, SOFTWARE_STATUSES, type SoftwareAggregate } from "@/types/api";

export function VersionChips({ versions, max = 3 }: { versions: string[]; max?: number }) {
  if (!versions.length) return <span className="text-muted-foreground">—</span>;
  const shown = versions.slice(0, max);
  const rest = versions.length - shown.length;
  return (
    <div className="flex max-w-[260px] flex-wrap gap-1">
      {shown.map((v) => (
        <Badge key={v} variant="outline" className="font-mono">
          {v}
        </Badge>
      ))}
      {rest > 0 && (
        <Badge variant="secondary" title={versions.slice(max).join(", ")}>
          +{rest}
        </Badge>
      )}
    </div>
  );
}

export function SoftwareInventoryTab() {
  const list = useListQuery<SoftwareAggregate>("software", "/software/inventory", {
    initial: { sortBy: "installCount", sortOrder: "desc" },
  });
  const [selected, setSelected] = React.useState<SoftwareAggregate | null>(null);

  const columns = React.useMemo<ColumnDef<SoftwareAggregate, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "publisher",
        header: "Publisher",
        meta: { label: "Publisher" },
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.publisher || "—"}</span>,
      },
      {
        id: "versions",
        header: "Versions",
        enableSorting: false,
        meta: { label: "Versions" },
        cell: ({ row }) => <VersionChips versions={row.original.versions ?? []} />,
      },
      {
        id: "installCount",
        header: "Installs",
        meta: { label: "Installs", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => formatNumber(row.original.installCount),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <StatusBadge value={row.original.status} meta={softwareStatusMeta} />,
      },
      {
        id: "open",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-8 text-right" },
        cell: () => <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />,
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
        getRowId={(r) => `${r.name}::${r.publisher ?? ""}`}
        onRowClick={setSelected}
        rowClassName={(r) => (r.status === "BLACKLISTED" ? "bg-sev-critical/5" : undefined)}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search software or publisher…" }}
        filters={
          <>
            <FilterSelect
              label="Status"
              value={list.state.filters.status as string | undefined}
              onChange={(v) => list.setFilter("status", v)}
              options={enumOptions(SOFTWARE_STATUSES, (v) => softwareStatusMeta[v].label)}
            />
            <FilterSelect
              label="Platform"
              value={list.state.filters.platform as string | undefined}
              onChange={(v) => list.setFilter("platform", v)}
              options={enumOptions(OS_PLATFORMS, (v) => platformLabel[v] ?? v)}
            />
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        empty={{ icon: Package, title: "No software found", description: "Inventory is collected by agents on their inventory interval." }}
      />
      <InventoryDevicesSheet item={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  );
}
