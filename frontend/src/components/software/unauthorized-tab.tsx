"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { softwareStatusMeta } from "@/lib/status";
import { formatNumber } from "@/lib/format";
import type { UnauthorizedSoftware } from "@/types/api";

type UninstallGroup = { name: string; deviceIds: string[] };

function groupByName(rows: UnauthorizedSoftware[]): UninstallGroup[] {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = m.get(r.name) ?? new Set<string>();
    set.add(r.device?.id ?? r.deviceId);
    m.set(r.name, set);
  }
  return Array.from(m, ([name, ids]) => ({ name, deviceIds: Array.from(ids) }));
}

export function SoftwareUnauthorizedTab() {
  const { can } = useAuth();
  const canWrite = can("software:write");
  const confirm = useConfirm();
  const list = useListQuery<UnauthorizedSoftware>("software", "/software/unauthorized", {
    initial: { sortBy: "firstSeenAt", sortOrder: "desc" },
  });

  const uninstall = useApiMutation(
    async (groups: UninstallGroup[]) => {
      const results = await Promise.all(groups.map((g) => api.post<{ commands: number }>("/software/uninstall", g)));
      return results.reduce((sum, r, i) => sum + (typeof r?.commands === "number" ? r.commands : groups[i].deviceIds.length), 0);
    },
    {
      success: (n) => `Queued ${formatNumber(n)} command${n === 1 ? "" : "s"}`,
      invalidate: [["software"], ["devices"]],
    },
  );
  const { mutate: runUninstall } = uninstall;

  const confirmAndUninstall = React.useCallback(
    async (rows: UnauthorizedSoftware[], clear?: () => void) => {
      const groups = groupByName(rows);
      const endpoints = new Set(groups.flatMap((g) => g.deviceIds)).size;
      const ok = await confirm({
        title: groups.length === 1 ? `Force uninstall "${groups[0].name}"?` : `Force uninstall ${groups.length} applications?`,
        description: (
          <div className="grid gap-2">
            <p>
              An uninstall command is queued for {formatNumber(endpoints)} endpoint{endpoints === 1 ? "" : "s"}. Agents execute it on their next check-in.
            </p>
            {groups.length > 1 && (
              <ul className="max-h-40 list-inside list-disc overflow-y-auto text-xs">
                {groups.map((g) => (
                  <li key={g.name}>
                    <span className="font-medium text-foreground">{g.name}</span> — {g.deviceIds.length} endpoint{g.deviceIds.length === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
        confirmLabel: "Force uninstall",
        destructive: true,
      });
      if (ok) runUninstall(groups, { onSuccess: () => clear?.() });
    },
    [confirm, runUninstall],
  );

  const columns = React.useMemo<ColumnDef<UnauthorizedSoftware, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "version",
        header: "Version",
        enableSorting: false,
        meta: { label: "Version" },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.version || "—"}</span>,
      },
      {
        id: "publisher",
        header: "Publisher",
        meta: { label: "Publisher" },
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.publisher || "—"}</span>,
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <StatusBadge value={row.original.status} meta={softwareStatusMeta} />,
      },
      {
        id: "device",
        header: "Endpoint",
        enableSorting: false,
        meta: { label: "Endpoint" },
        cell: ({ row }) => {
          const id = row.original.device?.id ?? row.original.deviceId;
          return (
            <Link href={`/devices/${id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium hover:text-primary hover:underline">
              {row.original.device?.deviceName ?? id}
            </Link>
          );
        },
      },
      {
        id: "firstSeenAt",
        header: "First seen",
        meta: { label: "First seen" },
        cell: ({ row }) => <RelativeTime value={row.original.firstSeenAt} className="text-xs" />,
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              header: "",
              enableSorting: false,
              enableHiding: false,
              meta: { className: "w-10 text-right" },
              cell: ({ row }) => (
                <SimpleTooltip label="Force uninstall">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Force uninstall ${row.original.name} from ${row.original.device?.deviceName ?? "endpoint"}`}
                    onClick={() => confirmAndUninstall([row.original])}
                  >
                    <Trash2 />
                  </Button>
                </SimpleTooltip>
              ),
            } satisfies ColumnDef<UnauthorizedSoftware, unknown>,
          ]
        : []),
    ],
    [canWrite, confirmAndUninstall],
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
      enableSelection={canWrite}
      bulkActions={(selected, clear) => (
        <Button size="xs" variant="destructive" loading={uninstall.isPending} onClick={() => confirmAndUninstall(selected, clear)}>
          <Trash2 /> Force uninstall
        </Button>
      )}
      rowClassName={(r) => (r.status === "BLACKLISTED" ? "bg-sev-critical/5" : undefined)}
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search software, endpoint…" }}
      empty={{
        icon: ShieldCheck,
        title: "No unauthorized software",
        description: "Every reported application matches the approved catalog or is unclassified.",
      }}
    />
  );
}
