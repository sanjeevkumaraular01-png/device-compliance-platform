"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Package, Pencil, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/common/confirm-dialog";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { Paginated, WorkProfile } from "@/types/api";
import { WorkProfileDialog } from "@/components/work-profiles/work-profile-dialog";

export default function WorkProfilesPage() {
  const { can } = useAuth();
  const canWrite = can("policies:write");
  const confirm = useConfirm();
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<WorkProfile | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const query = useQuery({
    queryKey: ["work-profiles", "list"],
    queryFn: async ({ signal }) =>
      normalizeList(
        await api.get<Paginated<WorkProfile> | WorkProfile[]>("/work-profiles", { pageSize: 200, sortBy: "name", sortOrder: "asc" }, { signal }),
      ).data,
  });

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = query.data ?? [];
    if (!q) return data;
    return data.filter((p) => [p.name, p.key, p.description, p.policy?.name].some((v) => v?.toLowerCase().includes(q)));
  }, [query.data, search]);

  const { mutate: removeProfile } = useApiMutation((p: WorkProfile) => api.delete(`/work-profiles/${p.id}`), {
    success: (_r, p) => `Work profile ${p.name} deleted`,
    invalidate: [["work-profiles"], ["users"]],
  });

  const openEdit = React.useCallback((p: WorkProfile | null) => {
    setEditing(p);
    setDialogOpen(true);
  }, []);

  const onDelete = React.useCallback(
    async (p: WorkProfile) => {
      const members = p._count?.users ?? 0;
      if (
        await confirm({
          title: `Delete ${p.name}?`,
          description: (
            <div className="grid gap-2">
              <p>This permanently removes the work profile.</p>
              {members > 0 && (
                <p className="rounded-md border border-sev-medium/30 bg-sev-medium/10 px-2.5 py-2 text-xs text-foreground">
                  {formatNumber(members)} employee(s) will keep working but lose this profile; their devices fall back to the department or default
                  policy on next evaluation.
                </p>
              )}
            </div>
          ),
          confirmLabel: "Delete work profile",
          destructive: true,
          typeToConfirm: members > 0 ? p.name : undefined,
        })
      ) {
        removeProfile(p);
      }
    },
    [confirm, removeProfile],
  );

  const columns = React.useMemo<ColumnDef<WorkProfile, unknown>[]>(() => {
    const cols: ColumnDef<WorkProfile, unknown>[] = [
      {
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Briefcase className="size-3.5" />
            </span>
            <div className="min-w-0">
              <span className="block max-w-[14rem] truncate font-medium">{row.original.name}</span>
              {row.original.description && (
                <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">{row.original.description}</span>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "key",
        header: "Type",
        meta: { label: "Type" },
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {row.original.key}
          </Badge>
        ),
      },
      {
        id: "policy",
        header: "Device policy",
        accessorFn: (p) => p.policy?.name ?? "",
        meta: { label: "Device policy" },
        cell: ({ row }) =>
          row.original.policy ? (
            <Badge variant="outline" className="max-w-[12rem] truncate">
              {row.original.policy.name}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Department / default</span>
          ),
      },
      {
        id: "required",
        header: "Required software",
        accessorFn: (p) => p.requiredSoftware?.length ?? 0,
        enableSorting: false,
        meta: { label: "Required software" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Package className="size-3" /> {formatNumber(row.original.requiredSoftware?.length ?? 0)}
          </span>
        ),
      },
      {
        id: "users",
        header: "Employees",
        accessorFn: (p) => p._count?.users ?? 0,
        meta: { label: "Employees", className: "text-right tabular-nums", headerClassName: "text-right" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-xs">
            <Users className="size-3 text-muted-foreground" /> {formatNumber(row.original._count?.users ?? 0)}
          </span>
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
        title="Work Profiles"
        icon={Briefcase}
        description="Role-based templates (Sales, HR, Finance, …). Assigning an employee to a device applies the profile's device policy automatically."
        actions={
          canWrite ? (
            <Button onClick={() => openEdit(null)}>
              <Plus /> New work profile
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
        getRowId={(p) => p.id}
        onRowClick={canWrite ? (p) => openEdit(p) : undefined}
        search={{ value: search, onChange: setSearch, placeholder: "Search work profiles…" }}
        empty={{
          icon: Briefcase,
          title: search ? "No matching work profiles" : "No work profiles yet",
          description: search ? "Try a different search term." : "Create role-based templates to automate policy and software per employee.",
          action:
            canWrite && !search ? (
              <Button size="sm" variant="outline" onClick={() => openEdit(null)}>
                <Plus /> New work profile
              </Button>
            ) : undefined,
        }}
      />
      <WorkProfileDialog profile={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
