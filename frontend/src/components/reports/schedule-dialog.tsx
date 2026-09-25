"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/common/misc";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { cn } from "@/lib/utils";
import type { ComplianceState, OsPlatform, ReportFormat, ReportParameters, ReportSchedule, ReportScheduleInput, ReportType } from "@/types/api";
import { COMPLIANCE_FILTERABLE, CRON_PRESETS, REPORT_TYPE_META, describeCron, isValidCron } from "@/components/reports/report-meta";
import { ReportFormatPicker, ReportScopeFields, ReportTypePicker, type ReportScopeValue } from "@/components/reports/report-form-parts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipients(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" /> New report schedule
          </DialogTitle>
          <DialogDescription>The report is generated automatically and emailed to the recipients as an attachment.</DialogDescription>
        </DialogHeader>
        <ScheduleForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<ReportType>("COMPLIANCE");
  const [format, setFormat] = React.useState<ReportFormat>("PDF");
  const [preset, setPreset] = React.useState<string>("weekly");
  const [customCron, setCustomCron] = React.useState("0 7 * * 1-5");
  const [recipientsText, setRecipientsText] = React.useState("");
  const [scope, setScope] = React.useState<ReportScopeValue>({});
  const [enabled, setEnabled] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);

  const cron = preset === "custom" ? customCron.trim() : (CRON_PRESETS.find((p) => p.id === preset)?.cron ?? "");
  const recipients = parseRecipients(recipientsText);
  const invalidEmails = recipients.filter((r) => !EMAIL_RE.test(r));

  const errors = {
    name: !name.trim() ? "Name is required" : undefined,
    cron: !isValidCron(cron) ? "Enter a 5-field cron expression (minute hour day month weekday)" : undefined,
    recipients:
      recipients.length === 0
        ? "Add at least one recipient"
        : invalidEmails.length
          ? `Invalid email: ${invalidEmails.join(", ")}`
          : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const create = useApiMutation((input: ReportScheduleInput) => api.post<ReportSchedule>("/reports/schedules", input), {
    success: (_d, v) => `Schedule "${v.name}" created`,
    invalidate: [["reports"]],
    onSuccess: onDone,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    const params: ReportParameters = {
      departmentId: scope.departmentId,
      platform: scope.platform as OsPlatform | undefined,
      complianceState: COMPLIANCE_FILTERABLE.includes(type) ? (scope.complianceState as ComplianceState | undefined) : undefined,
    };
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as ReportParameters;
    create.mutate({ name: name.trim(), type, format, cron, recipients, parameters: clean, enabled });
  };

  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Schedule name" htmlFor="sch-name" required error={show("name")}>
        <Input
          id="sch-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Weekly ${REPORT_TYPE_META[type].label.toLowerCase()} report`}
          maxLength={200}
          aria-invalid={!!show("name")}
        />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Report type</span>
        <ReportTypePicker value={type} onChange={setType} compact />
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Format</span>
        <ReportFormatPicker value={format} onChange={setFormat} />
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Frequency</span>
        <div role="radiogroup" aria-label="Frequency" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[...CRON_PRESETS, { id: "custom", label: "Custom", cron: "", description: "Cron expression" }].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                "rounded-md border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                preset === p.id && "border-primary bg-primary/5 ring-1 ring-primary/40 hover:bg-primary/5",
              )}
            >
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{p.description}</span>
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <Field label="Cron expression" htmlFor="sch-cron" error={show("cron")} hint={isValidCron(cron) ? describeCron(cron) : undefined}>
            <Input
              id="sch-cron"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              className="font-mono"
              placeholder="0 7 * * 1-5"
              aria-invalid={!!show("cron")}
            />
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">
            {describeCron(cron)} (server time) · <span className="font-mono">{cron}</span>
          </p>
        )}
      </div>

      <Field
        label="Recipients"
        htmlFor="sch-recipients"
        required
        error={show("recipients")}
        hint="Comma-separated email addresses."
      >
        <Input
          id="sch-recipients"
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          placeholder="ciso@company.com, it-ops@company.com"
          aria-invalid={!!show("recipients")}
        />
      </Field>

      <ReportScopeFields type={type} value={scope} onChange={setScope} idPrefix="sch" />

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div>
          <Label htmlFor="sch-enabled">Enabled</Label>
          <p className="text-xs text-muted-foreground">Disabled schedules are kept but do not run.</p>
        </div>
        <Switch id="sch-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create schedule
        </Button>
      </DialogFooter>
    </form>
  );
}
