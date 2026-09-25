"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { useConfirm } from "@/components/common/confirm-dialog";
import { OsIcon } from "@/components/common/os-icon";
import { RiskBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { SoftwareBlacklistDialog } from "@/components/software/blacklist-dialog";
import type { SoftwareBlacklist } from "@/types/api";

export function SoftwareBlacklistTab() {
  const { can } = useAuth();
  const canWrite = can("software:write");
  const confirm = useConfirm();
  const list = useListQuery<SoftwareBlacklist>("software", "/software/blacklist", { initial: { sortBy: "name", sortOrder: "asc" } });
  const [dialog, setDialog] = React.useState<{ open: boolean; entry: SoftwareBlacklist | null }>({ open: false, entry: null });

  const { mutate: remove } = useApiMutation((e: SoftwareBlacklist) => api.delete(`/software/blacklist/${e.id}`), {
    success: "Removed from the blacklist",
    invalidate: [["software"]],
  });

  const columns = React.useMemo<ColumnDef<SoftwareBlacklist, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="min-w-[140px]">
            <div className={row.original.matchType === "REGEX" ? "font-mono text-xs font-medium" : "font-medium"}>{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.publisher || "Any publisher"}</div>
          </div>
        ),
      },
      {
        id: "matchType",
        header: "Match",
        meta: { label: "Match type" },
        cell: ({ row }) => <Badge variant="outline">{humanize(row.original.matchType)}</Badge>,
      },
      {
        id: "platform",
        header: "Platform",
        meta: { label: "Platform" },
        cell: ({ row }) => (row.original.platform ? <OsIcon platform={row.original.platform} withLabel /> : <span className="text-xs text-muted-foreground">All</span>),
      },
      {
        id: "severity",
        header: "Severity",
        meta: { label: "Severity" },
        cell: ({ row }) => <RiskBadge value={row.original.severity} />,
      },
      {
        id: "reason",
        header: "Reason",
        enableSorting: false,
        meta: { label: "Reason" },
        cell: ({ row }) => (
          <span className="line-clamp-2 min-w-[180px] max-w-[320px] text-xs text-muted-foreground" title={row.original.reason}>
            {row.original.reason}
          </span>
        ),
      },
      {
        id: "autoUninstall",
        header: "Auto-uninstall",
        meta: { label: "Auto-uninstall" },
        cell: ({ row }) => (row.original.autoUninstall ? <Badge tone="critical">Enabled</Badge> : <Badge tone="neutral">Off</Badge>),
      },
      {
        id: "createdAt",
        header: "Added",
        meta: { label: "Added" },
        cell: ({ row }) => <RelativeTime value={row.original.createdAt} className="text-xs" />,
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.original.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setDialog({ open: true, entry: row.original })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={async () => {
                        const ok = await confirm({
                          title: `Remove "${row.original.name}" from the blacklist?`,
                          description: "Matching installations will no longer be flagged as blacklisted after re-classification.",
                          confirmLabel: "Remove",
                          destructive: true,
                        });
                        if (ok) remove(row.original);
                      }}
                    >
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies ColumnDef<SoftwareBlacklist, unknown>,
          ]
        : []),
    ],
    [canWrite, confirm, remove],
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
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search blacklist…" }}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setDialog({ open: true, entry: null })}>
              <Plus /> Blacklist software
            </Button>
          ) : undefined
        }
        empty={{ icon: Ban, title: "No blacklisted software", description: "Prohibited applications are flagged on every endpoint that reports them." }}
      />
      {canWrite && <SoftwareBlacklistDialog open={dialog.open} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} entry={dialog.entry} />}
    </>
  );
}
