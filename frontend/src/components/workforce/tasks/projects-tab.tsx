"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/common/status-badges";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmtDay, fmtHm, PercentBar } from "@/components/workforce/common";
import { dayPart, TASK_INVALIDATE } from "@/components/workforce/tasks/task-cells";
import { ProjectDialog } from "@/components/workforce/tasks/project-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListQuery } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { projectStatusMeta, type Tone } from "@/lib/status";
import type { Project } from "@/types/api";

/** Budget consumption → tone (lower is better; over budget = critical). */
function budgetTone(pctValue: number): Tone {
  if (pctValue > 100) return "critical";
  if (pctValue >= 90) return "high";
  if (pctValue >= 75) return "medium";
  return "success";
}

function BudgetCell({ project }: { project: Project }) {
  const budget = project.budgetHours;
  const tracked = typeof project.trackedSec === "number" ? project.trackedSec : null;
  if (tracked === null && !budget) return <span className="text-xs text-muted-foreground">—</span>;
  const used = tracked !== null && budget ? (tracked / 3600 / budget) * 100 : null;
  return (
    <div className="min-w-[150px]">
      <div className="text-xs tabular">
        <span className="font-medium">{tracked !== null ? fmtHm(tracked) : "—"}</span>
        <span className="text-muted-foreground"> / {budget ? `${formatNumber(budget)} h` : "no budget"}</span>
      </div>
      {used !== null && (
        <PercentBar value={Math.min(used, 100)} tone={budgetTone(used)} label={`Budget used for ${project.name}`} showValue={false} className="mt-1" />
      )}
      {used !== null && used > 100 && <div className="text-[11px] font-medium text-sev-critical">{Math.round(used)}% — over budget</div>}
    </div>
  );
}

export function ProjectsTab() {
  const { can } = useAuth();
  const canManage = can("tasks:manage");
  const confirm = useConfirm();
  const list = useListQuery<Project>("projects", "/projects", { initial: { sortBy: "name", sortOrder: "asc" } });
  const [editing, setEditing] = React.useState<Project | null>(null);
  const [creating, setCreating] = React.useState(false);

  const remove = useApiMutation((p: Project) => api.delete(`/projects/${p.id}`), {
    success: (_d, p) => `Project ${p.name} deleted`,
    errorTitle: "Could not delete the project",
    invalidate: TASK_INVALIDATE,
  });

  const onDelete = React.useCallback(
    async (p: Project) => {
      const tasks = p._count?.tasks ?? 0;
      const ok = await confirm({
        title: `Delete project ${p.name}?`,
        description:
          tasks > 0
            ? `${tasks} task${tasks === 1 ? " is" : "s are"} linked to this project. Depending on server rules they are detached or the deletion is refused.`
            : "This cannot be undone.",
        confirmLabel: "Delete project",
        destructive: true,
      });
      if (ok) remove.mutate(p);
    },
    [confirm, remove],
  );

  const columns = React.useMemo<ColumnDef<Project, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Project",
        meta: { label: "Project" },
        cell: ({ row }) => (
          <div className="min-w-[180px] max-w-[320px]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium" title={row.original.name}>
                {row.original.name}
              </span>
              <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{row.original.code}</span>
            </div>
            {row.original.description && <div className="truncate text-[11px] text-muted-foreground">{row.original.description}</div>}
          </div>
        ),
      },
      {
        id: "clientName",
        header: "Client",
        meta: { label: "Client" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.clientName || "—"}</span>,
      },
      {
        id: "department",
        header: "Department",
        enableSorting: false,
        meta: { label: "Department" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.department?.name ?? "—"}</span>,
      },
      {
        id: "owner",
        header: "Owner",
        enableSorting: false,
        meta: { label: "Owner" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.owner?.displayName ?? "—"}</span>,
      },
      { id: "status", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <StatusBadge value={row.original.status} meta={projectStatusMeta} /> },
      {
        id: "budget",
        header: "Tracked / budget",
        enableSorting: false,
        meta: { label: "Tracked vs budget" },
        cell: ({ row }) => <BudgetCell project={row.original} />,
      },
      {
        id: "dueDate",
        header: "Due",
        meta: { label: "Due date" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.dueDate ? fmtDay(dayPart(row.original.dueDate), "MMM d, yyyy") : "—"}</span>,
      },
      {
        id: "tasks",
        header: "Tasks",
        enableSorting: false,
        meta: { label: "Task count", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => (typeof row.original._count?.tasks === "number" ? formatNumber(row.original._count.tasks) : "—"),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-[1%]" },
        cell: ({ row }) =>
          canManage ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.original.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                    <Pencil /> Edit project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void onDelete(row.original)}>
                    <Trash2 /> Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    [canManage, onDelete],
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
        onRowClick={canManage ? (r) => setEditing(r) : undefined}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search projects…" }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New project
            </Button>
          ) : undefined
        }
        empty={{
          icon: FolderKanban,
          title: "No projects",
          description: canManage ? "Create a project to group tasks and track time against an hour budget." : "Projects with tasks assigned to you appear here.",
        }}
      />
      <ProjectDialog
        project={editing}
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </>
  );
}
