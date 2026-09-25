"use client";

import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badges";
import { fmtDay, fmtHm, fmtMinutes, todayLocal } from "@/components/workforce/common";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { taskPriorityMeta, taskStatusMeta, toneText, varianceTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type TaskSource, type TaskStatus, type WorkTask } from "@/types/api";

/** Query-key prefixes touched by any task change. */
export const TASK_INVALIDATE = [["tasks"], ["projects"], ["workforce"]];

export const OPEN_TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

export function isOpenTask(status: TaskStatus | null | undefined): boolean {
  return !!status && OPEN_TASK_STATUSES.includes(status);
}

/** yyyy-MM-dd part of a date or ISO timestamp ("" when missing/invalid). */
export function dayPart(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : "";
}

export function isOverdue(task: Pick<WorkTask, "dueDate" | "status">): boolean {
  const d = dayPart(task.dueDate);
  return !!d && d < todayLocal() && task.status !== "DONE" && task.status !== "CANCELLED";
}

/** variancePercent from the API, else computed from tracked vs estimate. Positive = over estimate. */
export function taskVariance(task: Pick<WorkTask, "variancePercent" | "estimatedMinutes" | "trackedSec">): number | null {
  if (typeof task.variancePercent === "number" && Number.isFinite(task.variancePercent)) return task.variancePercent;
  if (!task.estimatedMinutes || task.estimatedMinutes <= 0) return null;
  const tracked = (task.trackedSec ?? 0) / 60;
  return ((tracked - task.estimatedMinutes) / task.estimatedMinutes) * 100;
}

export const sourceLabel = (s: TaskSource | string | null | undefined) => (s === "SALES_CRM" ? "Sales CRM" : s === "HR" ? "HR" : humanize(s));

export function SourceBadge({ source }: { source: TaskSource | null | undefined }) {
  if (!source) return null;
  return (
    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
      {sourceLabel(source)}
    </Badge>
  );
}

export function PriorityBadge({ value }: { value: WorkTask["priority"] | null | undefined }) {
  return <StatusBadge value={value} meta={taskPriorityMeta} />;
}

export function TaskStatusBadge({ value }: { value: TaskStatus | null | undefined }) {
  return <StatusBadge value={value} meta={taskStatusMeta} />;
}

export function DueCell({ task }: { task: Pick<WorkTask, "dueDate" | "status"> }) {
  if (!task.dueDate) return <span className="text-xs text-muted-foreground">—</span>;
  const overdue = isOverdue(task);
  return (
    <span className={cn("whitespace-nowrap text-xs", overdue ? "font-medium text-sev-critical" : "text-muted-foreground")} title={overdue ? "Overdue" : undefined}>
      {fmtDay(dayPart(task.dueDate) || task.dueDate, "MMM d, yyyy")}
      {overdue && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

/** "1h 20m / 2h" — tracked vs estimate. */
export function TimeCell({ task }: { task: Pick<WorkTask, "trackedSec" | "estimatedMinutes"> }) {
  const over = !!task.estimatedMinutes && (task.trackedSec ?? 0) / 60 > task.estimatedMinutes;
  return (
    <span className="whitespace-nowrap text-xs tabular">
      <span className={cn("font-medium", over && "text-sev-high")}>{fmtHm(task.trackedSec ?? 0)}</span>
      <span className="text-muted-foreground"> / {task.estimatedMinutes ? fmtMinutes(task.estimatedMinutes) : "—"}</span>
    </span>
  );
}

export function VarianceCell({ task }: { task: Pick<WorkTask, "variancePercent" | "estimatedMinutes" | "trackedSec"> }) {
  const v = taskVariance(task);
  if (v === null) return <span className="text-xs text-muted-foreground">—</span>;
  const r = Math.round(v);
  return (
    <span className={cn("whitespace-nowrap text-xs font-medium tabular", toneText[varianceTone(v)])} title="Actual vs estimate (positive = over estimate)">
      {r > 0 ? "+" : ""}
      {r}%
    </span>
  );
}

export function DelayBadge({ count }: { count: number | null | undefined }) {
  if (!count || count < 1) return <span className="text-xs text-muted-foreground">0</span>;
  return (
    <Badge tone={count >= 2 ? "critical" : "medium"} title={`Due date moved later ${count} time${count === 1 ? "" : "s"}`}>
      {count}× delayed
    </Badge>
  );
}

/** Inline status select → PATCH /tasks/:id { status }. */
export function TaskStatusSelect({ task, disabled }: { task: Pick<WorkTask, "id" | "title" | "status">; disabled?: boolean }) {
  const update = useApiMutation((status: TaskStatus) => api.patch<WorkTask>(`/tasks/${task.id}`, { status }), {
    success: (_d, s) => `Status set to ${taskStatusMeta[s]?.label ?? s}`,
    errorTitle: "Could not update the task",
    invalidate: TASK_INVALIDATE,
  });
  const value = update.isPending && update.variables ? update.variables : task.status;
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Select value={value} onValueChange={(v) => v !== task.status && update.mutate(v as TaskStatus)} disabled={disabled || update.isPending}>
        <SelectTrigger size="sm" className={cn("h-7 w-[130px] text-xs", toneText[taskStatusMeta[value]?.tone ?? "neutral"])} aria-label={`Status of ${task.title}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TASK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {taskStatusMeta[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Title + project + source + external ref. */
export function TaskTitleCell({ task, showProject = true }: { task: WorkTask; showProject?: boolean }) {
  return (
    <div className="min-w-[200px] max-w-[380px]">
      <div className="truncate font-medium" title={task.title}>
        {task.title}
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {showProject && task.project && <span className="truncate">{task.project.name}</span>}
        {task.source && task.source !== "MANUAL" && <SourceBadge source={task.source} />}
        {task.externalRef && <span className="truncate font-mono">{task.externalRef}</span>}
      </div>
    </div>
  );
}
