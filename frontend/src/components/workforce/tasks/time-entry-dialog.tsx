"use client";

import * as React from "react";
import { format } from "date-fns";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/misc";
import { fmtHm } from "@/components/workforce/common";
import { TASK_INVALIDATE } from "@/components/workforce/tasks/task-cells";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { TimeEntry, WorkTask } from "@/types/api";

/** Manual time entry → POST /tasks/:id/time { startedAt, endedAt, note }. */
export function TimeEntryDialog({ task, onOpenChange }: { task: Pick<WorkTask, "id" | "title"> | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={!!task} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" /> Log time manually
          </DialogTitle>
          <DialogDescription className="break-words">{task ? `For “${task.title}”. Use this for work done away from the tracked computer.` : ""}</DialogDescription>
        </DialogHeader>
        {task && <TimeEntryForm key={task.id} task={task} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TimeEntryForm({ task, onDone }: { task: Pick<WorkTask, "id" | "title">; onDone: () => void }) {
  const uid = React.useId();
  const [start, setStart] = React.useState(() => {
    const d = new Date(Date.now() - 60 * 60_000);
    d.setSeconds(0, 0);
    return format(d, "yyyy-MM-dd'T'HH:mm");
  });
  const [end, setEnd] = React.useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const errors = {
    start: !start || Number.isNaN(startMs) ? "Start time is required" : undefined,
    end: !end || Number.isNaN(endMs) ? "End time is required" : endMs <= startMs ? "End must be after start" : endMs > Date.now() + 60_000 ? "End cannot be in the future" : undefined,
    note: note.trim().length < 3 ? "Describe briefly what you worked on" : undefined,
  };
  const valid = !errors.start && !errors.end && !errors.note;
  const durationSec = valid ? Math.round((endMs - startMs) / 1000) : null;

  const save = useApiMutation(
    () => api.post<TimeEntry>(`/tasks/${task.id}/time`, { startedAt: new Date(startMs).toISOString(), endedAt: new Date(endMs).toISOString(), note: note.trim() }),
    { success: "Time logged", errorTitle: "Could not log time", invalidate: TASK_INVALIDATE, onSuccess: onDone },
  );

  return (
    <form
      className="grid grid-cols-1 gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Started" htmlFor={`${uid}-start`} required error={touched ? errors.start : undefined}>
          <Input id={`${uid}-start`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={touched && !!errors.start} />
        </Field>
        <Field label="Ended" htmlFor={`${uid}-end`} required error={touched ? errors.end : undefined}>
          <Input id={`${uid}-end`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={touched && !!errors.end} />
        </Field>
      </div>
      <Field label="Note" htmlFor={`${uid}-note`} required error={touched ? errors.note : undefined}>
        <Textarea id={`${uid}-note`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Customer call about renewal terms" aria-invalid={touched && !!errors.note} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Duration: <span className="font-medium text-foreground tabular">{durationSec !== null ? fmtHm(durationSec) : "—"}</span>
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Log time
        </Button>
      </DialogFooter>
    </form>
  );
}
