"use client";

import * as React from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/misc";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import type { ComplianceState, CreateReportInput, OsPlatform, Report, ReportFormat, ReportParameters, ReportType } from "@/types/api";
import { COMPLIANCE_FILTERABLE, REPORT_TYPE_META } from "@/components/reports/report-meta";
import { ReportFormatPicker, ReportScopeFields, ReportTypePicker, type ReportScopeValue } from "@/components/reports/report-form-parts";
import { dateInputToIso } from "@/components/audit/dates";

export function GenerateReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-4 text-primary" /> Generate report
          </DialogTitle>
          <DialogDescription>Reports are generated in the background. You can download the file once it completes.</DialogDescription>
        </DialogHeader>
        {/* Content unmounts when closed, so the form resets on every open. */}
        <GenerateReportForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function GenerateReportForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<ReportType>("COMPLIANCE");
  const [format, setFormat] = React.useState<ReportFormat>("PDF");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [scope, setScope] = React.useState<ReportScopeValue>({});

  const rangeError = from && to && from > to ? "The start date must be before the end date" : undefined;

  const create = useApiMutation((input: CreateReportInput) => api.post<Report>("/reports", input), {
    success: (r) => `Report "${r?.name ?? "report"}" queued`,
    invalidate: [["reports"]],
    onSuccess: onDone,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rangeError) return;
    const parameters: ReportParameters = {
      from: dateInputToIso(from),
      to: dateInputToIso(to, true),
      departmentId: scope.departmentId,
      platform: scope.platform as OsPlatform | undefined,
      complianceState: COMPLIANCE_FILTERABLE.includes(type) ? (scope.complianceState as ComplianceState | undefined) : undefined,
    };
    const clean = Object.fromEntries(Object.entries(parameters).filter(([, v]) => v !== undefined)) as ReportParameters;
    create.mutate({
      name: name.trim() || undefined,
      type,
      format,
      parameters: Object.keys(clean).length ? clean : undefined,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Report name" htmlFor="rep-name" hint="Optional — a name is generated from the type and date when left empty.">
        <Input id="rep-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${REPORT_TYPE_META[type].label} report`} maxLength={200} />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Report type</span>
        <ReportTypePicker value={type} onChange={setType} />
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Format</span>
        <ReportFormatPicker value={format} onChange={setFormat} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From" htmlFor="rep-from" error={rangeError}>
          <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!rangeError} />
        </Field>
        <Field label="To" htmlFor="rep-to">
          <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!rangeError} />
        </Field>
      </div>

      <ReportScopeFields type={type} value={scope} onChange={setScope} idPrefix="rep" />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending} disabled={!!rangeError}>
          Generate report
        </Button>
      </DialogFooter>
    </form>
  );
}
