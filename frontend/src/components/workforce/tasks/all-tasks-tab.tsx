"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, ListTodo, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserPicker } from "@/components/users/user-picker";
import { PersonCell } from "@/components/workforce/common";
import { useProjects } from "@/components/workforce/queries";
import {
  DelayBadge,
  DueCell,
  PriorityBadge,
  sourceLabel,
  TaskStatusBadge,
  TaskStatusSelect,
  TaskTitleCell,
  TimeCell,
  VarianceCell,
} from "@/components/workforce/tasks/task-cells";
import { TaskDialog } from "@/components/workforce/tasks/task-dialog";
import { TimeEntryDialog } from "@/components/workforce/tasks/time-entry-dialog";
import { useListQuery } from "@/hooks/use-list-query";
import { useAuth } from "@/lib/auth";
import { taskStatusMeta } from "@/lib/status";
import { TASK_SOURCES, TASK_STATUSES, type WorkTask } from "@/types/api";

export function AllTasksTab() {
  const { can, user } = useAuth();
  const canManage = can("tasks:manage");
  const projects = useProjects();
  const list = useListQuery<WorkTask>(["tasks", "all"], "/tasks", {
    initial: { sortBy: "updatedAt", sortOrder: "desc" },
  });
  const [assigneeLabel, setAssigneeLabel] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<WorkTask | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [logFor, setLogFor] = React.useState<WorkTask | null>(null);

  const columns = React.useMemo<ColumnDef<WorkTask, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Task",
        meta: { label: "Task" },
        cell: ({ row }) => <TaskTitleCell task={row.original} showProject={false} />,
      },
      {
        id: "project",
        header: "Project",
        enableSorting: false,
        meta: { label: "Project" },
        cell: ({ row }) =>
          row.original.project ? (
            <span className="block max-w-[180px] truncate text-xs" title={row.original.project.name}>
              {row.original.project.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "assignee",
        header: "Assignee",
        enableSorting: false,
        meta: { label: "Assignee" },
        cell: ({ row }) =>
          row.original.assignee ? (
            <PersonCell name={row.original.assignee.displayName} sub={row.original.assignee.email} href={`/workforce/people/${row.original.assignee.id}`} className="max-w-[200px]" />
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          ),
      },
      {
        id: "source",
        header: "Source",
        meta: { label: "Source" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{sourceLabel(row.original.source)}</span>,
      },
      { id: "priority", header: "Priority", meta: { label: "Priority" }, cell: ({ row }) => <PriorityBadge value={row.original.priority} /> },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => (canManage ? <TaskStatusSelect task={row.original} /> : <TaskStatusBadge value={row.original.status} />),
      },
      { id: "dueDate", header: "Due", meta: { label: "Due date" }, cell: ({ row }) => <DueCell task={row.original} /> },
      {
        id: "delayCount",
        header: "Delays",
        meta: { label: "Delay count" },
        cell: ({ row }) => <DelayBadge count={row.original.delayCount} />,
      },
      {
        id: "time",
        header: "Actual / allocated",
        enableSorting: false,
        meta: { label: "Actual vs allocated" },
        cell: ({ row }) => <TimeCell task={row.original} />,
      },
      {
        id: "variance",
        header: "Variance",
        enableSorting: false,
        meta: { label: "Variance %", className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => <VarianceCell task={row.original} />,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-[1%]" },
        cell: ({ row }) => {
          const t = row.original;
          const mine = !!user && t.assigneeId === user.id;
          if (!canManage && !mine) return null;
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${t.title}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {canManage && (
                    <DropdownMenuItem onSelect={() => setEditing(t)}>
                      <Pencil /> Edit task
                    </DropdownMenuItem>
                  )}
                  {mine && (
                    <DropdownMenuItem onSelect={() => setLogFor(t)}>
                      <Clock /> Log time manually
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [canManage, user],
  );

  const projectOptions = (projects.data ?? []).map((p) => ({ value: p.id, label: p.name }));

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
        rowClassName={(r) => ((r.delayCount ?? 0) >= 2 ? "bg-sev-critical/5" : undefined)}
        initialColumnVisibility={{ source: false }}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search tasks…" }}
        filters={
          <>
            <FilterSelect
              label="Status"
              value={list.state.filters.status as string | undefined}
              onChange={(v) => list.setFilter("status", v)}
              options={TASK_STATUSES.map((s) => ({ value: s, label: taskStatusMeta[s].label }))}
            />
            <FilterSelect
              label="Source"
              value={list.state.filters.source as string | undefined}
              onChange={(v) => list.setFilter("source", v)}
              options={TASK_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }))}
            />
            {projectOptions.length > 0 && (
              <FilterSelect
                label="Project"
                value={list.state.filters.projectId as string | undefined}
                onChange={(v) => list.setFilter("projectId", v)}
                options={projectOptions}
              />
            )}
            <UserPicker
              size="sm"
              className="w-full sm:w-52"
              value={list.state.filters.assigneeId as string | undefined}
              selectedLabel={assigneeLabel}
              onChange={(id, u) => {
                setAssigneeLabel(u?.displayName ?? null);
                list.setFilter("assigneeId", id);
              }}
              placeholder="Any assignee"
              aria-label="Filter by assignee"
            />
            <ClearFiltersButton
              count={list.activeFilterCount}
              onClear={() => {
                setAssigneeLabel(null);
                list.clearFilters();
              }}
            />
          </>
        }
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New task
            </Button>
          ) : undefined
        }
        empty={{
          icon: ListTodo,
          title: "No tasks match",
          description: canManage ? "Create a task, or import tasks from a CRM, support desk or dev tool." : "Try other filters.",
        }}
      />
      <TaskDialog
        task={editing}
        open={creating || !!editing}
        mode="manage"
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
      <TimeEntryDialog task={logFor} onOpenChange={(o) => !o && setLogFor(null)} />
    </>
  );
}
