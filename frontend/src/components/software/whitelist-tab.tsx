"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, MoreHorizontal, PackageCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { useConfirm } from "@/components/common/confirm-dialog";
import { OsIcon } from "@/components/common/os-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatNumber, humanize } from "@/lib/format";
import { SoftwareWhitelistDialog } from "@/components/software/whitelist-dialog";
import type { SoftwareWhitelist } from "@/types/api";

export function SoftwareWhitelistTab() {
  const { can } = useAuth();
  const canWrite = can("software:write");
  const confirm = useConfirm();
  const list = useListQuery<SoftwareWhitelist>("software", "/software/whitelist", { initial: { sortBy: "name", sortOrder: "asc" } });
  const [dialog, setDialog] = React.useState<{ open: boolean; entry: SoftwareWhitelist | null }>({ open: false, entry: null });

  const { mutate: remove } = useApiMutation((e: SoftwareWhitelist) => api.delete(`/software/whitelist/${e.id}`), {
    success: "Removed from the approved catalog",
    invalidate: [["software"]],
  });

  const columns = React.useMemo<ColumnDef<SoftwareWhitelist, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <div className="flex items-center gap-1.5 font-medium">
              {row.original.matchType === "REGEX" ? <span className="font-mono text-xs">{row.original.name}</span> : row.original.name}
              {row.original.vendorUrl && /^https?:\/\//i.test(row.original.vendorUrl) && (
                <a
                  href={row.original.vendorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary"
                  aria-label={`Open vendor site for ${row.original.name}`}
                >
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
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
        id: "minVersion",
        header: "Min. version",
        enableSorting: false,
        meta: { label: "Minimum version" },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.minVersion || "—"}</span>,
      },
      {
        id: "category",
        header: "Category",
        meta: { label: "Category" },
        cell: ({ row }) => <span className="text-xs">{row.original.category || "—"}</span>,
      },
      {
        id: "platform",
        header: "Platform",
        meta: { label: "Platform" },
        cell: ({ row }) => (row.original.platform ? <OsIcon platform={row.original.platform} withLabel /> : <span className="text-xs text-muted-foreground">All</span>),
      },
      {
        id: "licenseType",
        header: "License",
        meta: { label: "License" },
        cell: ({ row }) =>
          row.original.licenseType ? (
            <div className="whitespace-nowrap text-xs">
              <div>{humanize(row.original.licenseType)}</div>
              {row.original.licenseCount !== null && <div className="text-muted-foreground">{formatNumber(row.original.licenseCount)} seats</div>}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Not tracked</span>
          ),
      },
      {
        id: "licenseExpiresAt",
        header: "Expires",
        meta: { label: "License expiry" },
        cell: ({ row }) => {
          const v = row.original.licenseExpiresAt;
          if (!v) return <span className="text-muted-foreground">—</span>;
          const expired = new Date(v).getTime() < Date.now();
          return <span className={expired ? "whitespace-nowrap text-xs font-medium text-sev-medium" : "whitespace-nowrap text-xs"}>{formatDate(v)}</span>;
        },
      },
      {
        id: "costPerSeat",
        header: "Cost / seat",
        meta: { label: "Cost per seat", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => formatCurrency(row.original.costPerSeat),
      },
      {
        id: "notes",
        header: "Notes",
        enableSorting: false,
        meta: { label: "Notes" },
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={row.original.notes}>
              {row.original.notes}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
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
                          title: `Remove "${row.original.name}" from the approved catalog?`,
                          description: "Matching installations will be re-classified on the next inventory report and may become unauthorized. License data for this entry is deleted.",
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
            } satisfies ColumnDef<SoftwareWhitelist, unknown>,
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
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search approved software…" }}
        initialColumnVisibility={{ notes: false }}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setDialog({ open: true, entry: null })}>
              <Plus /> Add software
            </Button>
          ) : undefined
        }
        empty={{ icon: PackageCheck, title: "The approved catalog is empty", description: "Add applications that are allowed on managed endpoints." }}
      />
      {canWrite && <SoftwareWhitelistDialog open={dialog.open} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} entry={dialog.entry} />}
    </>
  );
}
