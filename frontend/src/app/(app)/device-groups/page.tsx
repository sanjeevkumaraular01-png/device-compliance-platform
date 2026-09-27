"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Laptop, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/common/confirm-dialog";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { DeviceGroup, Paginated } from "@/types/api";
import { DeviceGroupDialog } from "@/components/device-groups/device-group-dialog";

export default function DeviceGroupsPage() {
  const { can } = useAuth();
  const canWrite = can("devices:write");
  const confirm = useConfirm();
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<DeviceGroup | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const query = useQuery({
    queryKey: ["device-groups", "list"],
    queryFn: async ({ signal }) =>
      normalizeList(
        await api.get<Paginated<DeviceGroup> | DeviceGroup[]>("/device-groups", { pageSize: 200, sortBy: "name", sortOrder: "asc" }, { signal }),
      ).data,
  });

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = query.data ?? [];
    if (!q) return data;
    return data.filter((g) => [g.name, g.description].some((v) => v?.toLowerCase().includes(q)));
  }, [query.data, search]);

  const { mutate: removeGroup } = useApiMutation((g: DeviceGroup) => api.delete(`/device-groups/${g.id}`), {
    success: (_r, g) => `Group ${g.name} deleted`,
    invalidate: [["device-groups"], ["devices"]],
  });

  const openEdit = React.useCallback((g: DeviceGroup | null) => {
    setEditing(g);
    setDialogOpen(true);
  }, []);

  const onDelete = React.useCallback(
    async (g: DeviceGroup) => {
      const devices = g._count?.devices ?? 0;
      if (
        await confirm({
          title: `Delete ${g.name}?`,
          description: (
            <div className="grid gap-2">
              <p>This removes the group. Devices are not deleted.</p>
              {devices > 0 && (
                <p className="rounded-md border border-sev-medium/30 bg-sev-medium/10 px-2.5 py-2 text-xs text-foreground">
                  {formatNumber(devices)} device(s) will be left without a group.
                </p>
              )}
            </div>
          ),
          confirmLabel: "Delete group",
          destructive: true,
          typeToConfirm: devices > 0 ? g.name : undefined,
        })
      ) {
        removeGroup(g);
      }
    },
    [confirm, removeGroup],
  );

  const columns = React.useMemo<ColumnDef<DeviceGroup, unknown>[]>(() => {
    const cols: ColumnDef<DeviceGroup, unknown>[] = [
      {
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground"
              style={row.original.color ? { backgroundColor: `${row.original.color}22`, color: row.original.color } : { background: "var(--muted)" }}
            >
              <Boxes className="size-3.5" />
            </span>
            <span className="max-w-[16rem] truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        enableSorting: false,
        meta: { label: "Description" },
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block max-w-[22rem] truncate text-xs text-muted-foreground" title={row.original.description}>
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "devices",
        header: "Devices",
        accessorFn: (g) => g._count?.devices ?? 0,
        meta: { label: "Devices", className: "text-right tabular-nums", headerClassName: "text-right" },
        cell: ({ row }) => (
          <Link href={`/devices?groupId=${row.original.id}`} className="inline-flex items-center gap-1 text-xs hover:underline" onClick={(e) => e.stopPropagation()}>
            <Laptop className="size-3 text-muted-foreground" /> {formatNumber(row.original._count?.devices ?? 0)}
          </Link>
        ),
      },
    ];
    if (canWrite) {
      cols.push({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px whitespace-nowrap text-right" },
        cell: ({ row }) => (
          <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            <SimpleTooltip label="Edit">
              <Button variant="ghost" size="icon-xs" aria-label={`Edit ${row.original.name}`} onClick={() => openEdit(row.original)}>
                <Pencil />
              </Button>
            </SimpleTooltip>
            <SimpleTooltip label="Delete">
              <Button variant="ghost" size="icon-xs" aria-label={`Delete ${row.original.name}`} onClick={() => onDelete(row.original)}>
                <Trash2 />
              </Button>
            </SimpleTooltip>
          </div>
        ),
      });
    }
    return cols;
  }, [canWrite, onDelete, openEdit]);

  return (
    <>
      <PageHeader
        title="Device Groups"
        icon={Boxes}
        description="Organize devices into groups for filtering and bulk operations. Assign a device to a group from its edit form."
        actions={
          canWrite ? (
            <Button onClick={() => openEdit(null)}>
              <Plus /> New group
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={query.isLoading}
        fetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        getRowId={(g) => g.id}
        onRowClick={canWrite ? (g) => openEdit(g) : undefined}
        search={{ value: search, onChange: setSearch, placeholder: "Search groups…" }}
        empty={{
          icon: Boxes,
          title: search ? "No matching groups" : "No device groups yet",
          description: search ? "Try a different search term." : "Create groups to organize your fleet.",
          action:
            canWrite && !search ? (
              <Button size="sm" variant="outline" onClick={() => openEdit(null)}>
                <Plus /> New group
              </Button>
            ) : undefined,
        }}
      />
      <DeviceGroupDialog group={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
