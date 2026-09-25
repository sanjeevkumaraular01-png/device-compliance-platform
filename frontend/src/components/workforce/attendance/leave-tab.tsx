"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarOff, CalendarPlus, Info } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { DateRangeFilter } from "@/components/data-table/filters";
import { Field } from "@/components/common/misc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserPicker } from "@/components/users/user-picker";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListQuery } from "@/hooks/use-list-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { DepartmentFilter, PersonCell, fmtDay, todayLocal } from "@/components/workforce/common";
import type { AttendanceRow } from "@/types/api";

export function AttendanceLeaveTab() {
  const { can } = useAuth();
  const canManage = can("workforce:manage");
  const [open, setOpen] = React.useState(false);

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="size-4 text-primary" aria-hidden /> Leave
            </CardTitle>
            <CardDescription className="max-w-2xl">
              Marking leave sets each day in the range to <span className="font-medium text-foreground">On leave</span> for that employee, so it
              is not counted as absent, late or missing time and no attendance alerts are raised. Existing tracked activity is kept. Every change is
              written to the audit log.
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <CalendarPlus /> Mark leave
            </Button>
          )}
        </CardHeader>
        {!canManage && (
          <CardContent>
            <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              You can view leave records. Marking leave requires the workforce management permission.
            </p>
          </CardContent>
        )}
      </Card>

      <LeaveList />

      {canManage && <MarkLeaveDialog open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function LeaveList() {
  const list = useListQuery<AttendanceRow>(["workforce", "attendance", "leave"], "/workforce/attendance", {
    initial: { pageSize: 10 },
    fixedParams: React.useMemo(() => ({ status: "ON_LEAVE" }), []),
  });
  const f = list.state.filters;

  const columns = React.useMemo<ColumnDef<AttendanceRow, unknown>[]>(
    () => [
      {
        id: "employee",
        header: "Employee",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <PersonCell
            className="min-w-[180px] max-w-[260px]"
            name={row.original.user?.displayName ?? "Unknown employee"}
            sub={row.original.user?.department?.name ?? row.original.user?.email}
            href={row.original.userId ? `/workforce/people/${row.original.userId}?date=${encodeURIComponent(row.original.date ?? "")}` : undefined}
          />
        ),
      },
      {
        id: "date",
        header: "Date",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDay(row.original.date, "EEE, MMM d, yyyy")}</span>,
      },
      {
        id: "reason",
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-[420px] truncate text-xs text-muted-foreground" title={row.original.adjustmentNote ?? undefined}>
            {row.original.adjustmentNote || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
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
      getRowId={(r) => r.id}
      columnToggle={false}
      maxHeight="28rem"
      filters={
        <>
          <span className="mr-1 text-xs font-medium">Leave days</span>
          <DateRangeFilter
            from={f.from as string | undefined}
            to={f.to as string | undefined}
            onChange={(r) => {
              list.setFilter("from", r.from);
              list.setFilter("to", r.to);
            }}
          />
          <DepartmentFilter value={f.departmentId as string | undefined} onChange={(v) => list.setFilter("departmentId", v)} />
        </>
      }
      empty={{ icon: CalendarOff, title: "No leave recorded", description: "Days marked as leave appear here." }}
    />
  );
}

const schema = z
  .object({
    userId: z.string({ required_error: "Select an employee" }).min(1, "Select an employee"),
    from: z.string().min(1, "Start date is required"),
    to: z.string().min(1, "End date is required"),
    reason: z.string().trim().min(3, "Reason is required").max(500),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { path: ["to"], message: "End date must be on or after the start date" });
type Values = z.infer<typeof schema>;

function MarkLeaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-4 text-primary" /> Mark leave
          </DialogTitle>
          <DialogDescription>The selected days are recorded as On leave for this employee. This action is audited.</DialogDescription>
        </DialogHeader>
        {open && <MarkLeaveForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MarkLeaveForm({ onDone }: { onDone: () => void }) {
  const today = todayLocal();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { userId: "", from: today, to: today, reason: "" },
  });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation((v: Values) => api.post("/workforce/leave", { userId: v.userId, from: v.from, to: v.to, reason: v.reason.trim() }), {
    success: "Leave recorded",
    invalidate: [["workforce"]],
    onSuccess: onDone,
  });

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-1 gap-4" noValidate>
      <Field label="Employee" htmlFor="leave-user" required error={errors.userId?.message}>
        <Controller
          control={control}
          name="userId"
          render={({ field }) => <UserPicker id="leave-user" value={field.value || undefined} onChange={(id) => field.onChange(id ?? "")} placeholder="Select an employee…" />}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From" htmlFor="leave-from" required error={errors.from?.message}>
          <Input id="leave-from" type="date" {...register("from")} aria-invalid={!!errors.from} />
        </Field>
        <Field label="To" htmlFor="leave-to" required error={errors.to?.message}>
          <Input id="leave-to" type="date" {...register("to")} aria-invalid={!!errors.to} />
        </Field>
      </div>
      <Field label="Reason" htmlFor="leave-reason" required error={errors.reason?.message}>
        <Textarea id="leave-reason" rows={3} {...register("reason")} aria-invalid={!!errors.reason} placeholder="e.g. Annual leave (approved in HRMS)" />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Mark leave
        </Button>
      </DialogFooter>
    </form>
  );
}
