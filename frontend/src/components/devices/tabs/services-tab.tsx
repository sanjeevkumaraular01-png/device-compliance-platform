"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Cog } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { useListQuery } from "@/hooks/use-list-query";
import { humanize } from "@/lib/format";
import type { DeviceService } from "@/types/api";

export function ServicesTab({ deviceId }: { deviceId: string }) {
  const list = useListQuery<DeviceService>(["devices", deviceId, "services"], `/devices/${deviceId}/services`, {
    initial: { sortBy: "name", sortOrder: "asc" },
  });

  const columns = React.useMemo<ColumnDef<DeviceService, unknown>[]>(
    () => [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: "Service",
        enableHiding: false,
        meta: { label: "Service", className: "min-w-[220px] max-w-[360px]" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium" title={row.original.displayName ?? row.original.name}>
              {row.original.displayName || row.original.name}
            </div>
            <div className="truncate font-mono text-[10px] text-muted-foreground" title={row.original.name}>
              {row.original.name}
            </div>
          </div>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => {
          const running = row.original.status?.toUpperCase() === "RUNNING";
          return (
            <Badge variant={running ? "default" : "secondary"} className={running ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" : undefined}>
              {humanize(row.original.status || "UNKNOWN")}
            </Badge>
          );
        },
      },
      {
        id: "startType",
        accessorKey: "startType",
        header: "Startup",
        meta: { label: "Startup" },
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.startType ? humanize(row.original.startType) : "—"}</span>,
      },
    ],
    [],
  );

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
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search services…" }}
      empty={{ icon: Cog, title: list.state.search ? "No matching services" : "No services reported yet" }}
    />
  );
}
