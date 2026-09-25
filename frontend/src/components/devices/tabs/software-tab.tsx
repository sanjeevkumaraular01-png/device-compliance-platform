"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Package, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/common/status-badges";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { usePermission } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { softwareStatusMeta } from "@/lib/status";
import type { SoftwareInventory } from "@/types/api";

function formatSizeMb(mb: number | null): string {
  if (mb === null || mb === undefined) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function SoftwareTab({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const canWrite = usePermission("software:write");
  const confirm = useConfirm();
  const list = useListQuery<SoftwareInventory>(["devices", deviceId, "software"], `/devices/${deviceId}/software`, {
    initial: { sortBy: "name", sortOrder: "asc" },
  });

  const uninstall = useApiMutation((name: string) => api.post<{ commands: number }>("/software/uninstall", { deviceIds: [deviceId], name }), {
    success: (_r, name) => `Uninstall of “${name}” queued — the agent removes it on its next check-in`,
    invalidate: [["devices", deviceId]],
  });
  const runUninstall = uninstall.mutate;

  const onUninstall = React.useCallback(
    async (s: SoftwareInventory) => {
      const ok = await confirm({
        title: `Uninstall ${s.name}?`,
        description: (
          <>
            An <span className="font-mono text-xs">UNINSTALL_SOFTWARE</span> command will be queued for <span className="font-medium">{deviceName}</span>. The
            user may lose unsaved work in this application.
          </>
        ),
        confirmLabel: "Queue uninstall",
        destructive: true,
      });
      if (ok) runUninstall(s.name);
    },
    [confirm, deviceName, runUninstall],
  );

  const columns = React.useMemo<ColumnDef<SoftwareInventory, unknown>[]>(() => {
    const cols: ColumnDef<SoftwareInventory, unknown>[] = [
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        enableHiding: false,
        meta: { label: "Name", className: "min-w-[200px] max-w-[320px]" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium" title={row.original.name}>
              {row.original.name}
            </div>
            {row.original.installLocation && (
              <div className="truncate font-mono text-[10px] text-muted-foreground" title={row.original.installLocation}>
                {row.original.installLocation}
              </div>
            )}
          </div>
        ),
      },
      { id: "version", accessorKey: "version", header: "Version", meta: { label: "Version" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.version || "—"}</span> },
      {
        id: "publisher",
        accessorKey: "publisher",
        header: "Publisher",
        meta: { label: "Publisher", className: "max-w-[200px]" },
        cell: ({ row }) => <span className="block truncate">{row.original.publisher ?? "—"}</span>,
      },
      { id: "status", accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <StatusBadge value={row.original.status} meta={softwareStatusMeta} /> },
      { id: "installDate", accessorKey: "installDate", header: "Installed", meta: { label: "Install date" }, cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.installDate)}</span> },
      { id: "source", accessorKey: "source", header: "Source", meta: { label: "Source" }, cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.source ?? "—"}</span> },
      { id: "sizeMb", accessorKey: "sizeMb", header: "Size", meta: { label: "Size", className: "text-right", headerClassName: "text-right" }, cell: ({ row }) => <span className="text-xs tabular">{formatSizeMb(row.original.sizeMb)}</span> },
    ];
    if (canWrite) {
      cols.push({
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-10 text-right" },
        cell: ({ row }) => (
          <SimpleTooltip label="Uninstall">
            <Button variant="ghost" size="icon-xs" aria-label={`Uninstall ${row.original.name}`} onClick={() => void onUninstall(row.original)}>
              <Trash2 className="text-destructive" />
            </Button>
          </SimpleTooltip>
        ),
      });
    }
    return cols;
  }, [canWrite, onUninstall]);

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
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search software…" }}
      rowClassName={(r) => (r.status === "BLACKLISTED" ? "bg-sev-critical/5" : undefined)}
      empty={{ icon: Package, title: list.state.search ? "No matching software" : "No software inventory reported yet" }}
    />
  );
}
