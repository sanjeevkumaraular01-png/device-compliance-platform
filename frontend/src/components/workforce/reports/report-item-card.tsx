"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { Field } from "@/components/common/misc";
import { StatusBadge } from "@/components/common/status-badges";
import { taskStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DailyReportItemInput, TaskStatus, WorkTask } from "@/types/api";
import type { ItemErrors, ItemField } from "@/components/workforce/reports/report-validation";

/** Editor state for one item (strings everywhere; converted on save). */
export interface ItemDraft {
  uid: string;
  taskId: string | null;
  taskTitle: string;
  projectName: string;
  workCompleted: string;
  result: string;
  pendingWork: string;
  blocker: string;
  nextAction: string;
  evidenceUrl: string;
  minutes: string;
  /** Status of the linked task as reported by the server item (fallback when not in "my tasks"). */
  linkedStatus?: TaskStatus | null;
}

let seq = 0;
export const newUid = () => `it${++seq}-${Date.now().toString(36)}`;

export function blankItem(): ItemDraft {
  return { uid: newUid(), taskId: null, taskTitle: "", projectName: "", workCompleted: "", result: "", pendingWork: "", blocker: "", nextAction: "", evidenceUrl: "", minutes: "" };
}

export function toDraft(it: Partial<DailyReportItemInput> & { task?: { status?: TaskStatus } | null }): ItemDraft {
  return {
    uid: newUid(),
    taskId: it.taskId ?? null,
    taskTitle: it.taskTitle ?? "",
    projectName: it.projectName ?? "",
    workCompleted: it.workCompleted ?? "",
    result: it.result ?? "",
    pendingWork: it.pendingWork ?? "",
    blocker: it.blocker ?? "",
    nextAction: it.nextAction ?? "",
    evidenceUrl: it.evidenceUrl ?? "",
    minutes: typeof it.minutesSpent === "number" && Number.isFinite(it.minutesSpent) ? String(Math.round(it.minutesSpent)) : "",
    linkedStatus: it.task?.status ?? null,
  };
}

export function toInput(d: ItemDraft): DailyReportItemInput {
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  const m = d.minutes.trim();
  return {
    taskId: d.taskId,
    projectName: opt(d.projectName),
    taskTitle: d.taskTitle.trim(),
    workCompleted: d.workCompleted.trim(),
    result: d.result.trim(),
    pendingWork: opt(d.pendingWork),
    blocker: opt(d.blocker),
    nextAction: opt(d.nextAction),
    evidenceUrl: opt(d.evidenceUrl),
    minutesSpent: m && /^\d+$/.test(m) ? Number(m) : null,
  };
}

export function isBlank(d: ItemDraft): boolean {
  return !d.taskId && [d.taskTitle, d.projectName, d.workCompleted, d.result, d.pendingWork, d.blocker, d.nextAction, d.evidenceUrl, d.minutes].every((s) => !s.trim());
}

const FREE = "__free";

export function ReportItemCard({
  item,
  index,
  count,
  tasks,
  taskStatus,
  errors,
  onChange,
  onRemove,
  onMove,
}: {
  item: ItemDraft;
  index: number;
  count: number;
  tasks: WorkTask[];
  taskStatus: TaskStatus | undefined;
  errors: ItemErrors | undefined;
  onChange: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const base = React.useId();
  const id = (f: string) => `${base}-item${index}-${f}`;
  const err = (f: ItemField) => errors?.[f]?.join(" ") || undefined;
  const hasErrors = !!errors && Object.values(errors).some((a) => a && a.length > 0);
  const linked = item.taskId ? tasks.find((t) => t.id === item.taskId) : undefined;
  const needsFollowUp = !!item.taskId && taskStatus !== "DONE";
  const wcLen = item.workCompleted.trim().length;

  const text = (f: Exclude<ItemField, "minutesSpent">, key: keyof ItemDraft = f as keyof ItemDraft) => ({
    id: id(f),
    value: item[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ [key]: e.target.value } as Partial<ItemDraft>),
    "aria-invalid": !!err(f),
  });

  return (
    <article
      className={cn("rounded-lg border bg-card p-3 shadow-xs", hasErrors && "border-destructive/50")}
      aria-labelledby={id("heading")}
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded bg-muted text-xs font-semibold tabular" aria-hidden>
          {index + 1}
        </span>
        <h3 id={id("heading")} className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.taskTitle.trim() || `Item ${index + 1}`}
          <span className="sr-only"> (item {index + 1} of {count})</span>
        </h3>
        {item.taskId && taskStatus && <StatusBadge value={taskStatus} meta={taskStatusMeta} />}
        <div className="flex shrink-0 items-center">
          <SimpleTooltip label="Move up">
            <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move item ${index + 1} up`}>
              <ArrowUp />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip label="Move down">
            <Button type="button" variant="ghost" size="icon-xs" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move item ${index + 1} down`}>
              <ArrowDown />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip label="Remove item">
            <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} aria-label={`Remove item ${index + 1}`} className="text-muted-foreground hover:text-destructive">
              <Trash2 />
            </Button>
          </SimpleTooltip>
        </div>
      </header>

      {errors?._item && errors._item.length > 0 && (
        <ul role="alert" className="mb-3 list-disc space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 py-1.5 pl-6 pr-2 text-xs text-destructive">
          {errors._item.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Linked task" htmlFor={id("task")} hint="Pick one of your tasks, or describe free-text work below.">
            <Select
              value={item.taskId ?? FREE}
              onValueChange={(v) => {
                if (v === FREE) return onChange({ taskId: null, linkedStatus: null });
                const t = tasks.find((x) => x.id === v);
                onChange({
                  taskId: v,
                  taskTitle: t?.title ?? item.taskTitle,
                  projectName: t?.project?.name ?? item.projectName,
                  linkedStatus: t?.status ?? null,
                });
              }}
            >
              <SelectTrigger id={id("task")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FREE}>Free text (no linked task)</SelectItem>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                    {t.project ? ` · ${t.project.name}` : ""}
                  </SelectItem>
                ))}
                {item.taskId && !linked && <SelectItem value={item.taskId}>{item.taskTitle || "Linked task"}</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <Field label="Project" htmlFor={id("projectName")} error={err("projectName")}>
              <Input {...text("projectName")} placeholder="Optional" />
            </Field>
            <Field label="Minutes" htmlFor={id("minutesSpent")} error={err("minutesSpent")}>
              <Input
                id={id("minutesSpent")}
                inputMode="numeric"
                value={item.minutes}
                onChange={(e) => onChange({ minutes: e.target.value })}
                className="tabular"
                placeholder="60"
                aria-invalid={!!err("minutesSpent")}
              />
            </Field>
          </div>
        </div>

        <Field label="Task" htmlFor={id("taskTitle")} required error={err("taskTitle")}>
          <Input {...text("taskTitle")} placeholder="What did you work on?" />
        </Field>

        <Field
          label="Work completed"
          htmlFor={id("workCompleted")}
          required
          error={err("workCompleted")}
          hint={
            <span className="flex flex-wrap justify-between gap-2">
              <span>Be specific — at least 15 characters, not just “working on”.</span>
              <span className={cn("tabular", wcLen > 0 && wcLen < 15 && "text-sev-medium")}>{wcLen} chars</span>
            </span>
          }
        >
          <Textarea {...text("workCompleted")} rows={3} placeholder="Fixed the CSV export timeout for large departments; added a regression test." />
        </Field>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Result" htmlFor={id("result")} required error={err("result")}>
            <Textarea {...text("result")} rows={2} placeholder="Export now completes in 4 s; PR #412 merged." />
          </Field>
          <Field label="Pending work" htmlFor={id("pendingWork")} error={err("pendingWork")}>
            <Textarea {...text("pendingWork")} rows={2} placeholder="Optional" />
          </Field>
          <Field
            label="Blocker"
            htmlFor={id("blocker")}
            required={needsFollowUp && !item.nextAction.trim()}
            error={err("blocker")}
            hint={needsFollowUp ? "Linked task isn’t done: give a blocker or a next action." : undefined}
          >
            <Textarea {...text("blocker")} rows={2} placeholder="Waiting on access to the staging database" />
          </Field>
          <Field label="Next action" htmlFor={id("nextAction")} required={needsFollowUp && !item.blocker.trim()} error={err("nextAction")}>
            <Textarea {...text("nextAction")} rows={2} placeholder="Deploy to staging tomorrow morning" />
          </Field>
        </div>

        <Field label="Evidence / link" htmlFor={id("evidenceUrl")} error={err("evidenceUrl")}>
          <Input {...text("evidenceUrl")} type="url" inputMode="url" placeholder="https://…" />
        </Field>
      </div>
    </article>
  );
}
