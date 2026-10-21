"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Building2, LayoutGrid, Laptop, List, Pencil, Plus, Search, Trash2, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SummaryTile } from "@/components/common/summary-tile";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/common/confirm-dialog";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Department, Paginated } from "@/types/api";
import { DepartmentDialog } from "@/components/departments/department-dialog";
import { DepartmentCard, departmentAccent, departmentDevices, departmentUsers } from "@/components/departments/department-card";

type View = "cards" | "table";
const VIEW_KEY = "sem.departments.view";

export default function DepartmentsPage() {
  const { can } = useAuth();
  const canWrite = can("users:write");
  const confirm = useConfirm();
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<Department | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [view, setViewState] = React.useState<View>("cards");

  React.useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "cards" || v === "table") setViewState(v);
    } catch {
      /* storage unavailable: keep the default view */
    }
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const query = useQuery({
    queryKey: ["departments", "list"],
    queryFn: async ({ signal }) =>
      normalizeList(
        await api.get<Paginated<Department> | Department[]>("/departments", { pageSize: 200, sortBy: "name", sortOrder: "asc" }, { signal }),
      ).data,
  });

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = query.data ?? [];
    if (!q) return data;
    return data.filter((d) =>
      [d.name, d.code, d.description, d.manager?.displayName, d.policy?.name].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [query.data, search]);

  const hasUserCounts = (query.data ?? []).some((d) => departmentUsers(d) !== undefined);
  const hasDeviceCounts = (query.data ?? []).some((d) => departmentDevices(d) !== undefined);

  const summary = React.useMemo(() => {
    const data = query.data ?? [];
    return {
      departments: data.length,
      employees: hasUserCounts ? data.reduce((n, d) => n + (departmentUsers(d) ?? 0), 0) : undefined,
      devices: hasDeviceCounts ? data.reduce((n, d) => n + (departmentDevices(d) ?? 0), 0) : undefined,
      noManager: data.filter((d) => !d.manager).length,
      customPolicy: data.filter((d) => d.policy).length,
    };
  }, [query.data, hasUserCounts, hasDeviceCounts]);

  const { mutate: removeDepartment } = useApiMutation((d: Department) => api.delete(`/departments/${d.id}`), {
    success: (_r, d) => `Department ${d.name} deleted`,
    invalidate: [["departments"], ["users"]],
  });

  const openEdit = React.useCallback((d: Department | null) => {
    setEditing(d);
    setDialogOpen(true);
  }, []);

  const onDelete = React.useCallback(
    async (d: Department) => {
      const members = departmentUsers(d) ?? 0;
      const devices = departmentDevices(d) ?? 0;
      if (
        await confirm({
          title: `Delete ${d.name}?`,
          description: (
            <div className="grid gap-2">
              <p>This permanently removes the department.</p>
              {(members > 0 || devices > 0) && (
                <p className="rounded-md border border-sev-medium/30 bg-sev-medium/10 px-2.5 py-2 text-xs text-foreground">
                  {formatNumber(members)} user(s) and {formatNumber(devices)} device(s) will be left without a department and fall back to the
                  default policy.
                </p>
              )}
            </div>
          ),
          confirmLabel: "Delete department",
          destructive: true,
          typeToConfirm: members > 0 || devices > 0 ? d.code : undefined,
        })
      ) {
        removeDepartment(d);
      }
    },
    [confirm, removeDepartment],
  );

  const columns = React.useMemo<ColumnDef<Department, unknown>[]>(() => {
    const cols: ColumnDef<Department, unknown>[] = [
      {
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", departmentAccent(row.original.code))}>
              <Building2 className="size-3.5" />
            </span>
            <span className="max-w-[14rem] truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "code",
        header: "Code",
        meta: { label: "Code" },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: "description",
        header: "Description",
        enableSorting: false,
        meta: { label: "Description" },
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block max-w-[18rem] truncate text-xs text-muted-foreground" title={row.original.description}>
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "manager",
        header: "Manager",
        accessorFn: (d) => d.manager?.displayName ?? "",
        meta: { label: "Manager" },
        cell: ({ row }) =>
          row.original.manager ? (
            <div className="min-w-0 text-xs">
              <p className="max-w-[12rem] truncate">{row.original.manager.displayName}</p>
              <p className="max-w-[12rem] truncate text-muted-foreground">{row.original.manager.email}</p>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          ),
      },
      {
        id: "policy",
        header: "Policy",
        accessorFn: (d) => d.policy?.name ?? "",
        meta: { label: "Policy" },
        cell: ({ row }) =>
          row.original.policy ? (
            <Badge variant="outline" className="max-w-[12rem] truncate">
              {row.original.policy.name}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Default</span>
          ),
      },
    ];
    if (hasUserCounts) {
      cols.push({
        id: "users",
        header: "Users",
        accessorFn: (d) => departmentUsers(d) ?? 0,
        meta: { label: "Users", className: "text-right tabular-nums", headerClassName: "text-right" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-xs">
            <Users className="size-3 text-muted-foreground" /> {formatNumber(departmentUsers(row.original) ?? 0)}
          </span>
        ),
      });
    }
    if (hasDeviceCounts) {
      cols.push({
        id: "devices",
        header: "Devices",
        accessorFn: (d) => departmentDevices(d) ?? 0,
        meta: { label: "Devices", className: "text-right tabular-nums", headerClassName: "text-right" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-xs">
            <Laptop className="size-3 text-muted-foreground" /> {formatNumber(departmentDevices(row.original) ?? 0)}
          </span>
        ),
      });
    }
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
  }, [canWrite, hasDeviceCounts, hasUserCounts, onDelete, openEdit]);

  const emptyProps = {
    icon: Building2,
    title: search ? "No matching departments" : "No departments yet",
    description: search ? "Try a different search term." : "Create departments to group users and devices.",
    action:
      canWrite && !search ? (
        <Button size="sm" variant="outline" onClick={() => openEdit(null)}>
          <Plus /> New department
        </Button>
      ) : undefined,
  };

  return (
    <>
      <PageHeader
        title="Departments"
        icon={Building2}
        description="Organizational units used for row-level scoping, manager oversight and default device policies."
        actions={
          canWrite ? (
            <Button onClick={() => openEdit(null)}>
              <Plus /> New department
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile icon={Building2} label="Departments" value={query.isLoading ? undefined : summary.departments} />
        <SummaryTile icon={Users} label="Employees" value={query.isLoading ? undefined : summary.employees} />
        <SummaryTile icon={Laptop} label="Devices" value={query.isLoading ? undefined : summary.devices} />
        <SummaryTile
          icon={UserRound}
          label="Without a manager"
          value={query.isLoading ? undefined : summary.noManager}
          hint={query.isLoading ? undefined : `${summary.customPolicy} with a custom policy`}
          warn={!query.isLoading && summary.noManager > 0}
        />
      </div>

      {view === "cards" ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="department-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search departments…"
                className="pl-8"
                aria-label="Search departments"
              />
            </div>
            <ViewToggle view={view} onChange={setView} />
          </div>
          {query.error ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : query.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <CardSkeleton key={i} className="h-52" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState {...emptyProps} />
          ) : (
            <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", query.isFetching && "opacity-70 transition-opacity")}>
              {rows.map((d) => (
                <DepartmentCard key={d.id} department={d} canWrite={canWrite} onEdit={openEdit} onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex justify-end">
            <ViewToggle view={view} onChange={setView} />
          </div>
          <DataTable
            columns={columns}
            data={rows}
            loading={query.isLoading}
            fetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            getRowId={(d) => d.id}
            onRowClick={canWrite ? (d) => openEdit(d) : undefined}
            search={{ value: search, onChange: setSearch, placeholder: "Search departments…" }}
            empty={emptyProps}
          />
        </div>
      )}
      <DepartmentDialog department={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="Layout">
      {(
        [
          ["cards", LayoutGrid, "Cards"],
          ["table", List, "Table"],
        ] as const
      ).map(([v, Icon, label]) => (
        <Button
          key={v}
          size="sm"
          variant={view === v ? "secondary" : "ghost"}
          className="h-7 gap-1.5 px-2.5"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
        >
          <Icon className="size-3.5" /> {label}
        </Button>
      ))}
    </div>
  );
}
