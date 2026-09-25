"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, ListTodo, MoreHorizontal, Pause, Pencil, Plus, Timer } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmtClock, useElapsed } from "@/components/workforce/common";
import { TaskTimerButton, useRunningTimer, useStopTimer } from "@/components/workforce/task-timer";
import {
  DueCell,
  isOpenTask,
  PriorityBadge,
  TaskStatusSelect,
  TaskTitleCell,
  TimeCell,
} from "@/components/workforce/tasks/task-cells";
import { TaskDialog } from "@/components/workforce/tasks/task-dialog";
import { TimeEntryDialog } from "@/components/workforce/tasks/time-entry-dialog";
import { useListQuery } from "@/hooks/use-list-query";
import { useAuth } from "@/lib/auth";
import { taskStatusMeta } from "@/lib/status";
import { TASK_STATUSES, type WorkTask } from "@/types/api";

const MINE = { mine: true } as const;
/** Pseudo-filter value: every status except DONE / CANCELLED (filtered client-side, see below). */
const OPEN = "open";

/** Banner shown while a timer runs (any task). */
export function RunningTimerBanner() {
  const running = useRunningTimer();
  const stop = useStopTimer();
  const elapsed = useElapsed(running?.startedAt ?? null);
  if (!running) return null;
  const title = running.task?.title ?? "Task timer";
  const project = running.task?.project?.name;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-sev-none/35 bg-sev-none/8 px-3 py-2.5">
      <Timer className="size-4 shrink-0 animate-pulse text-sev-none" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          <span className="text-muted-foreground">Tracking: </span>
          {title}
        </div>
        {project && <div className="truncate text-xs text-muted-foreground">{project}</div>}
      </div>
      <span className="font-mono text-base font-semibold text-sev-none tabular" aria-label={`Elapsed ${fmtClock(elapsed)}`}>
        {fmtClock(elapsed)}
      </span>
      <Button variant="outline" size="sm" onClick={() => stop.mutate()} loading={stop.isPending}>
        {!stop.isPending && <Pause />} Stop
      </Button>
    </div>
  );
}

export function MyTasksTab() {
  const { user, can } = useAuth();
  const canManage = can("tasks:manage");
  const list = useListQuery<WorkTask>(["tasks", "mine"], "/tasks", {
    fixedParams: MINE,
    initial: { sortBy: "dueDate", sortOrder: "asc", pageSize: 50 },
  });
  // The API filters by a single `status`; "Open" is not an API value, so for it we request all
  // statuses and hide DONE / CANCELLED on the client (the page total then includes closed tasks).
  const [statusFilter, setStatusFilter] = React.useState<string>(OPEN);
  const onStatus = (v: string | undefined) => {
    const next = v ?? "all";
    setStatusFilter(next);
    list.setFilter("status", next === OPEN || next === "all" ? undefined : next);
  };
  const rows = statusFilter === OPEN ? list.rows.filter((t) => isOpenTask(t.status)) : list.rows;
  const hidden = list.rows.length - rows.length;

  const [editing, setEditing] = React.useState<WorkTask | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [logFor, setLogFor] = React.useState<WorkTask | null>(null);

  const columns = React.useMemo<ColumnDef<WorkTask, unknown>[]>(
    () => [
      { id: "title", header: "Task", enableSorting: false, meta: { label: "Task" }, cell: ({ row }) => <TaskTitleCell task={row.original} /> },
      { id: "priority", header: "Priority", meta: { label: "Priority" }, cell: ({ row }) => <PriorityBadge value={row.original.priority} /> },
      { id: "status", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <TaskStatusSelect task={row.original} /> },
      { id: "dueDate", header: "Due", meta: { label: "Due date" }, cell: ({ row }) => <DueCell task={row.original} /> },
      {
        id: "time",
        header: "Tracked / est.",
        enableSorting: false,
        meta: { label: "Tracked vs estimate" },
        cell: ({ row }) => <TimeCell task={row.original} />,
      },
      {
        id: "timer",
        header: () => <span className="sr-only">Timer</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-[1%]" },
        cell: ({ row }) => <TaskTimerButton task={row.original} />,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-[1%]" },
        cell: ({ row }) => {
          const t = row.original;
          const canEdit = canManage || (!!user && t.createdById === user.id);
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${t.title}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => setLogFor(t)}>
                    <Clock /> Log time manually
                  </DropdownMenuItem>
                  {canEdit && (
                    <DropdownMenuItem onSelect={() => setEditing(t)}>
                      <Pencil /> Edit task
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

  return (
    <>
      <RunningTimerBanner />
      <DataTable
        columns={columns}
        data={rows}
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
        rowClassName={(r) => (r.status === "BLOCKED" ? "bg-sev-critical/5" : undefined)}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search my tasks…" }}
        filters={
          <>
            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={onStatus}
              allLabel="All"
              options={[{ value: OPEN, label: "Open" }, ...TASK_STATUSES.map((s) => ({ value: s, label: taskStatusMeta[s].label }))]}
            />
            {statusFilter === OPEN && hidden > 0 && (
              <span className="text-xs text-muted-foreground">
                {hidden} closed task{hidden === 1 ? "" : "s"} hidden on this page
              </span>
            )}
          </>
        }
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        }
        empty={{
          icon: ListTodo,
          title: statusFilter === OPEN ? "No open tasks" : "No tasks",
          description: "Tasks assigned to you, or created by you, appear here. Start a timer to track time against a task.",
          action: (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus /> New task
            </Button>
          ),
        }}
      />
      <TaskDialog
        task={editing}
        open={creating || !!editing}
        mode={editing && canManage ? "manage" : "self"}
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
