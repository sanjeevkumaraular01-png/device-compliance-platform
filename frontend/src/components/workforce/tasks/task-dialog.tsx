"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { UserPicker } from "@/components/users/user-picker";
import { useProjects } from "@/components/workforce/queries";
import { dayPart, sourceLabel, TASK_INVALIDATE } from "@/components/workforce/tasks/task-cells";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { taskPriorityMeta, taskStatusMeta } from "@/lib/status";
import { TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES, type TaskInput, type TaskPriority, type TaskSource, type TaskStatus, type WorkTask } from "@/types/api";

const NONE = "__none";

const intString = (max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) <= max), `${label} must be a whole number between 0 and ${max}`);

const schema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(300),
    description: z.string().trim().max(5000).optional(),
    projectId: z.string().optional(),
    assigneeId: z.string().optional(),
    source: z.enum(TASK_SOURCES),
    externalRef: z.string().trim().max(200).optional(),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
    estHours: intString(1000, "Hours"),
    estMinutes: intString(59, "Minutes"),
    dueDate: z.string().optional(),
  });
type Values = z.infer<typeof schema>;

export interface TaskDialogProps {
  /** null = create */
  task: WorkTask | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** "self": employee creating/editing own tasks (no assignee / source fields). */
  mode: "self" | "manage";
}

export function TaskDialog({ task, open, onOpenChange, mode }: TaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="size-4 text-primary" /> {task ? "Edit task" : "New task"}
          </DialogTitle>
          <DialogDescription>
            {mode === "self"
              ? "Tasks you create are assigned to you. Track time against them with the timer."
              : "Assign work, set an estimate and a due date. Tracked time is compared with the estimate."}
          </DialogDescription>
        </DialogHeader>
        {open && <TaskForm key={task?.id ?? "new"} task={task} mode={mode} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ task, mode, onDone }: { task: WorkTask | null; mode: "self" | "manage"; onDone: () => void }) {
  const uid = React.useId();
  const id = (f: string) => `${uid}-${f}`;
  const projects = useProjects();
  const est = task?.estimatedMinutes ?? null;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      projectId: task?.projectId ?? undefined,
      assigneeId: task?.assigneeId ?? undefined,
      source: task?.source ?? "MANUAL",
      externalRef: task?.externalRef ?? "",
      priority: task?.priority ?? "MEDIUM",
      status: task?.status ?? "TODO",
      estHours: est !== null ? String(Math.floor(est / 60)) : "",
      estMinutes: est !== null ? String(est % 60) : "",
      dueDate: dayPart(task?.dueDate) || "",
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation(
    (input: TaskInput) => (task ? api.patch<WorkTask>(`/tasks/${task.id}`, input) : api.post<WorkTask>("/tasks", input)),
    {
      success: (_d, v) => (task ? `Task “${v.title}” updated` : `Task “${v.title}” created`),
      errorTitle: task ? "Could not update the task" : "Could not create the task",
      invalidate: TASK_INVALIDATE,
      onSuccess: onDone,
    },
  );

  const onSubmit = handleSubmit((v) => {
    const hasEst = v.estHours !== "" || v.estMinutes !== "";
    const estimatedMinutes = hasEst ? Number(v.estHours || 0) * 60 + Number(v.estMinutes || 0) : null;
    const input: TaskInput = {
      title: v.title,
      description: v.description || null,
      projectId: v.projectId ?? null,
      priority: v.priority as TaskPriority,
      estimatedMinutes,
      dueDate: v.dueDate || null,
    };
    // POST /tasks does not accept `status` (strict DTO); new tasks start as TODO.
    if (task) input.status = v.status as TaskStatus;
    if (mode === "manage") {
      input.assigneeId = v.assigneeId ?? null;
      input.source = v.source as TaskSource;
      input.externalRef = v.externalRef || null;
    }
    save.mutate(input);
  });

  const projectList = projects.data ?? [];

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4" noValidate>
      <Field label="Title" htmlFor={id("title")} required error={errors.title?.message}>
        <Input id={id("title")} {...register("title")} aria-invalid={!!errors.title} placeholder="Prepare Q3 pipeline review" autoFocus />
      </Field>
      <Field label="Description" htmlFor={id("desc")} error={errors.description?.message}>
        <Textarea id={id("desc")} rows={3} {...register("description")} />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project" htmlFor={id("project")}>
          <Controller
            control={control}
            name="projectId"
            render={({ field }) => (
              <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? undefined : v)}>
                <SelectTrigger id={id("project")}>
                  <SelectValue placeholder={projects.isLoading ? "Loading…" : "No project"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No project</SelectItem>
                  {projectList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} <span className="font-mono text-[10px] text-muted-foreground">{p.code}</span>
                    </SelectItem>
                  ))}
                  {field.value && !projectList.some((p) => p.id === field.value) && task?.project && (
                    <SelectItem value={field.value}>{task.project.name}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        {mode === "manage" ? (
          <Field label="Assignee" htmlFor={id("assignee")} hint="Leave empty for an unassigned task.">
            <Controller
              control={control}
              name="assigneeId"
              render={({ field }) => (
                <UserPicker id={id("assignee")} value={field.value} onChange={(v) => field.onChange(v)} selectedLabel={task?.assignee?.displayName} placeholder="Unassigned" />
              )}
            />
          </Field>
        ) : (
          <Field label="Assignee" htmlFor={id("assignee-self")}>
            <Input id={id("assignee-self")} value="You" disabled readOnly />
          </Field>
        )}
      </div>

      {mode === "manage" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Source" htmlFor={id("source")} hint="Where the task comes from (CRM, support desk, dev tools…).">
            <Controller
              control={control}
              name="source"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={id("source")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {sourceLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="External reference" htmlFor={id("ext")} hint="Ticket / deal / issue id in the source system." error={errors.externalRef?.message}>
            <Input id={id("ext")} {...register("externalRef")} className="font-mono" placeholder="SUP-1042" />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Priority" htmlFor={id("priority")}>
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={id("priority")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {taskPriorityMeta[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        {task && (
        <Field label="Status" htmlFor={id("status")}>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={id("status")}>
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
            )}
          />
        </Field>
        )}
        <Field
          label="Due date"
          htmlFor={id("due")}
          hint={task ? "Moving the due date later counts as a delay (delay count +1)." : undefined}
        >
          <Input id={id("due")} type="date" {...register("dueDate")} />
        </Field>
      </div>

      <fieldset className="grid grid-cols-1 gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Estimate (allocated time)</legend>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              id={id("est-h")}
              inputMode="numeric"
              {...register("estHours")}
              className="w-20 tabular"
              placeholder="0"
              aria-label="Estimated hours"
              aria-invalid={!!errors.estHours}
            />
            <label htmlFor={id("est-h")} className="text-xs text-muted-foreground">
              hours
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              id={id("est-m")}
              inputMode="numeric"
              {...register("estMinutes")}
              className="w-20 tabular"
              placeholder="0"
              aria-label="Estimated minutes"
              aria-invalid={!!errors.estMinutes}
            />
            <label htmlFor={id("est-m")} className="text-xs text-muted-foreground">
              minutes
            </label>
          </div>
        </div>
        {errors.estHours?.message || errors.estMinutes?.message ? (
          <p className="text-xs text-destructive">{errors.estHours?.message ?? errors.estMinutes?.message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Leave empty when there is no estimate. Variance = (tracked − estimate) / estimate.</p>
        )}
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {task ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
