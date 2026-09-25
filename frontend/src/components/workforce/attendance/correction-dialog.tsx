"use client";

import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, isValid, parseISO } from "date-fns";
import { ShieldCheck, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { attendanceMeta, locationMeta } from "@/lib/status";
import { fmtDay } from "@/components/workforce/common";
import {
  ATTENDANCE_STATUSES,
  WORK_LOCATIONS,
  type AttendanceCorrectionInput,
  type AttendanceRow,
  type AttendanceStatus,
  type WorkLocation,
} from "@/types/api";

/** ISO → value for <input type="datetime-local"> (browser local time). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return isValid(d) ? format(d, "yyyy-MM-dd'T'HH:mm") : "";
}

/** datetime-local value → ISO (UTC); undefined when empty/invalid. */
function fromLocalInput(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const schema = z
  .object({
    clockInAt: z.string().optional(),
    clockOutAt: z.string().optional(),
    status: z.enum(ATTENDANCE_STATUSES),
    location: z.enum(WORK_LOCATIONS),
    note: z.string().trim().min(5, "Explain the correction (at least 5 characters)").max(1000),
  })
  .refine((v) => !v.clockInAt || !v.clockOutAt || new Date(v.clockOutAt).getTime() > new Date(v.clockInAt).getTime(), {
    path: ["clockOutAt"],
    message: "Clock out must be after clock in",
  });
type Values = z.infer<typeof schema>;

export function AttendanceCorrectionDialog({ row, onOpenChange }: { row: AttendanceRow | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="size-4 text-primary" /> Correct attendance
          </DialogTitle>
          <DialogDescription>
            {row ? (
              <>
                {row.user?.displayName ?? "Employee"} · {fmtDay(row.date, "EEE, MMM d, yyyy")}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {row && <CorrectionForm key={row.id} row={row} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionForm({ row, onDone }: { row: AttendanceRow; onDone: () => void }) {
  const initial: Values = {
    clockInAt: toLocalInput(row.clockInAt),
    clockOutAt: toLocalInput(row.clockOutAt),
    status: (ATTENDANCE_STATUSES as readonly string[]).includes(row.status) ? row.status : "PRESENT",
    location: (WORK_LOCATIONS as readonly string[]).includes(row.location) ? row.location : "UNKNOWN",
    note: "",
  };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation((input: AttendanceCorrectionInput) => api.patch(`/workforce/attendance/${row.id}`, input), {
    success: "Attendance corrected",
    invalidate: [["workforce"]],
    onSuccess: onDone,
  });

  const onSubmit = handleSubmit((v) => {
    const input: AttendanceCorrectionInput = { note: v.note.trim() };
    if (v.clockInAt && v.clockInAt !== initial.clockInAt) input.clockInAt = fromLocalInput(v.clockInAt);
    if (v.clockOutAt && v.clockOutAt !== initial.clockOutAt) input.clockOutAt = fromLocalInput(v.clockOutAt);
    if (v.status !== row.status) input.status = v.status as AttendanceStatus;
    if (v.location !== row.location) input.location = v.location as WorkLocation;
    save.mutate(input);
  });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Clock in" htmlFor="corr-in" error={errors.clockInAt?.message}>
          <Input id="corr-in" type="datetime-local" {...register("clockInAt")} aria-invalid={!!errors.clockInAt} />
        </Field>
        <Field label="Clock out" htmlFor="corr-out" error={errors.clockOutAt?.message}>
          <Input id="corr-out" type="datetime-local" {...register("clockOutAt")} aria-invalid={!!errors.clockOutAt} />
        </Field>
        <Field label="Status" htmlFor="corr-status">
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="corr-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {attendanceMeta[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Location" htmlFor="corr-location">
          <Controller
            control={control}
            name="location"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="corr-location" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {locationMeta[l].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>
      <Field label="Reason for correction" htmlFor="corr-note" required error={errors.note?.message}>
        <Textarea
          id="corr-note"
          rows={3}
          {...register("note")}
          aria-invalid={!!errors.note}
          placeholder="e.g. Forgot to clock out; confirmed with team lead"
        />
      </Field>
      <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        Corrections are recorded in the audit log with your name, the previous values and this reason. The record is marked as manually
        adjusted and late, overtime and missing minutes are recalculated.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save correction
        </Button>
      </DialogFooter>
    </form>
  );
}
