"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useDepartments } from "@/hooks/use-lookups";
import { platformLabel } from "@/lib/format";
import { complianceMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { COMPLIANCE_STATES, OS_PLATFORMS, REPORT_FORMATS, REPORT_TYPES, type ReportFormat, type ReportType } from "@/types/api";
import { COMPLIANCE_FILTERABLE, REPORT_FORMAT_META, REPORT_TYPE_META } from "@/components/reports/report-meta";

const ANY = "__any";

/** Grid of report type tiles (radio group). */
export function ReportTypePicker({ value, onChange, compact }: { value: ReportType; onChange: (v: ReportType) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Report type" className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {REPORT_TYPES.map((t) => {
        const m = REPORT_TYPE_META[t];
        const Icon = m.icon;
        const active = value === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t)}
            className={cn(
              "flex min-w-0 items-start gap-2.5 rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary bg-primary/5 ring-1 ring-primary/40 hover:bg-primary/5",
            )}
          >
            <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground", active && "bg-primary/15 text-primary")}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{m.label}</span>
              {!compact && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{m.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Segmented PDF / Excel / CSV choice. */
export function ReportFormatPicker({ value, onChange }: { value: ReportFormat; onChange: (v: ReportFormat) => void }) {
  return (
    <div role="radiogroup" aria-label="Format" className="inline-flex w-full rounded-md border bg-muted p-0.5 sm:w-auto">
      {REPORT_FORMATS.map((f) => {
        const m = REPORT_FORMAT_META[f];
        const Icon = m.icon;
        const active = value === f;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(f)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
              active && "bg-card text-foreground shadow-sm",
            )}
          >
            <Icon className="size-3.5" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ReportScopeValue {
  departmentId?: string;
  platform?: string;
  complianceState?: string;
}

/** Department / platform / compliance state selects shared by report + schedule dialogs. */
export function ReportScopeFields({
  type,
  value,
  onChange,
  idPrefix,
}: {
  type: ReportType;
  value: ReportScopeValue;
  onChange: (v: ReportScopeValue) => void;
  idPrefix: string;
}) {
  const departments = useDepartments();
  const showCompliance = COMPLIANCE_FILTERABLE.includes(type);
  const set = (patch: Partial<ReportScopeValue>) => onChange({ ...value, ...patch });

  return (
    <div className={cn("grid grid-cols-1 gap-3", showCompliance ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      <Field label="Department" htmlFor={`${idPrefix}-dept`}>
        <Select value={value.departmentId ?? ANY} onValueChange={(v) => set({ departmentId: v === ANY ? undefined : v })}>
          <SelectTrigger id={`${idPrefix}-dept`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All departments</SelectItem>
            {(departments.data ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Platform" htmlFor={`${idPrefix}-platform`}>
        <Select value={value.platform ?? ANY} onValueChange={(v) => set({ platform: v === ANY ? undefined : v })}>
          <SelectTrigger id={`${idPrefix}-platform`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All platforms</SelectItem>
            {OS_PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                {platformLabel[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {showCompliance && (
        <Field label="Compliance state" htmlFor={`${idPrefix}-state`}>
          <Select value={value.complianceState ?? ANY} onValueChange={(v) => set({ complianceState: v === ANY ? undefined : v })}>
            <SelectTrigger id={`${idPrefix}-state`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any state</SelectItem>
              {COMPLIANCE_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {complianceMeta[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}
