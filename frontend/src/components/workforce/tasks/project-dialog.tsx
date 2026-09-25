"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { UserPicker } from "@/components/users/user-picker";
import { dayPart, TASK_INVALIDATE } from "@/components/workforce/tasks/task-cells";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import { projectStatusMeta } from "@/lib/status";
import { PROJECT_STATUSES, type Project, type ProjectInput, type ProjectStatus } from "@/types/api";

const NONE = "__none";

const schema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    code: z
      .string()
      .trim()
      .min(1, "Code is required")
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, "Use uppercase letters, digits, - or _"),
    description: z.string().trim().max(5000).optional(),
    clientName: z.string().trim().max(200).optional(),
    departmentId: z.string().optional(),
    ownerId: z.string().optional(),
    status: z.enum(PROJECT_STATUSES),
    budgetHours: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 1_000_000), "Whole number of hours"),
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { path: ["dueDate"], message: "Due date must be on or after the start date" });
type Values = z.infer<typeof schema>;

export function ProjectDialog({ project, open, onOpenChange }: { project: Project | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="size-4 text-primary" /> {project ? "Edit project" : "New project"}
          </DialogTitle>
          <DialogDescription>Projects group tasks, carry an hour budget and roll up tracked time.</DialogDescription>
        </DialogHeader>
        {open && <ProjectForm key={project?.id ?? "new"} project={project} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({ project, onDone }: { project: Project | null; onDone: () => void }) {
  const uid = React.useId();
  const id = (f: string) => `${uid}-${f}`;
  const deps = useDepartments();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project?.name ?? "",
      code: project?.code ?? "",
      description: project?.description ?? "",
      clientName: project?.clientName ?? "",
      departmentId: project?.departmentId ?? undefined,
      ownerId: project?.ownerId ?? undefined,
      status: project?.status ?? "ACTIVE",
      budgetHours: project?.budgetHours !== null && project?.budgetHours !== undefined ? String(project.budgetHours) : "",
      startDate: dayPart(project?.startDate),
      dueDate: dayPart(project?.dueDate),
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation(
    (input: ProjectInput) => (project ? api.patch<Project>(`/projects/${project.id}`, input) : api.post<Project>("/projects", input)),
    {
      success: (_d, v) => (project ? `Project ${v.name} updated` : `Project ${v.name} created`),
      errorTitle: project ? "Could not update the project" : "Could not create the project",
      invalidate: TASK_INVALIDATE,
      onSuccess: onDone,
    },
  );

  const onSubmit = handleSubmit((v) =>
    save.mutate({
      name: v.name,
      code: v.code.toUpperCase(),
      description: v.description || null,
      clientName: v.clientName || null,
      departmentId: v.departmentId ?? null,
      ownerId: v.ownerId ?? null,
      status: v.status as ProjectStatus,
      budgetHours: v.budgetHours === "" ? null : Number(v.budgetHours),
      startDate: v.startDate || null,
      dueDate: v.dueDate || null,
    }),
  );

  const codeField = register("code");
  const depList = deps.data ?? [];

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="Name" htmlFor={id("name")} required error={errors.name?.message}>
          <Input id={id("name")} {...register("name")} aria-invalid={!!errors.name} placeholder="Website relaunch" autoFocus />
        </Field>
        <Field label="Code" htmlFor={id("code")} required error={errors.code?.message}>
          <Input
            id={id("code")}
            {...codeField}
            onChange={(e) => {
              e.target.value = e.target.value.toUpperCase().replace(/\s+/g, "_");
              void codeField.onChange(e);
            }}
            className="font-mono uppercase"
            placeholder="WEB"
            aria-invalid={!!errors.code}
          />
        </Field>
      </div>
      <Field label="Description" htmlFor={id("desc")} error={errors.description?.message}>
        <Textarea id={id("desc")} rows={2} {...register("description")} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client" htmlFor={id("client")} error={errors.clientName?.message}>
          <Input id={id("client")} {...register("clientName")} placeholder="Internal" />
        </Field>
        <Field label="Department" htmlFor={id("dep")}>
          <Controller
            control={control}
            name="departmentId"
            render={({ field }) => (
              <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? undefined : v)}>
                <SelectTrigger id={id("dep")}>
                  <SelectValue placeholder={deps.isLoading ? "Loading…" : "No department"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No department</SelectItem>
                  {depList.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                  {field.value && !depList.some((d) => d.id === field.value) && project?.department && (
                    <SelectItem value={field.value}>{project.department.name}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Owner" htmlFor={id("owner")}>
          <Controller
            control={control}
            name="ownerId"
            render={({ field }) => (
              <UserPicker id={id("owner")} value={field.value} onChange={(v) => field.onChange(v)} selectedLabel={project?.owner?.displayName} placeholder="No owner" />
            )}
          />
        </Field>
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
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {projectStatusMeta[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Budget (hours)" htmlFor={id("budget")} error={errors.budgetHours?.message}>
          <Input id={id("budget")} inputMode="numeric" {...register("budgetHours")} className="tabular" placeholder="—" aria-invalid={!!errors.budgetHours} />
        </Field>
        <Field label="Start date" htmlFor={id("start")}>
          <Input id={id("start")} type="date" {...register("startDate")} />
        </Field>
        <Field label="Due date" htmlFor={id("due")} error={errors.dueDate?.message}>
          <Input id={id("due")} type="date" {...register("dueDate")} aria-invalid={!!errors.dueDate} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {project ? "Save changes" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
