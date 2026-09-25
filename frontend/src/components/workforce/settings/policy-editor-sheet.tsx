"use client";

import * as React from "react";
import {
  AlarmClock,
  AlertTriangle,
  Camera,
  CalendarClock,
  Eye,
  MapPin,
  MousePointerClick,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WorkforcePolicy, WorkforcePolicyInput } from "@/types/api";
import {
  INT_FIELDS,
  WEEKDAYS,
  networkError,
  timezones,
  toBody,
  toDraft,
  validateDraft,
  type IntKey,
  type PolicyDraft,
} from "@/components/workforce/settings/policy-model";

type BoolKey = {
  [K in keyof PolicyDraft]: PolicyDraft[K] extends boolean ? K : never;
}[keyof PolicyDraft];

const INTERVALS = [10, 15, 30];

export function PolicyEditorSheet({
  open,
  onOpenChange,
  policy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = create */
  policy: WorkforcePolicy | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{policy ? `Edit policy · ${policy.name}` : "New workforce policy"}</SheetTitle>
          <SheetDescription>
            Work schedule, activity tracking, screenshots, office networks, discipline rules and transparency for the departments that use this
            policy.
          </SheetDescription>
        </SheetHeader>
        {open && <PolicyForm key={policy?.id ?? "new"} policy={policy} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-start gap-3 border-b px-4 py-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function ToggleRow({
  id,
  label,
  help,
  checked,
  onChange,
  children,
}: {
  id: string;
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          {help && <p className="text-xs text-muted-foreground">{help}</p>}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      </div>
      {children}
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-sev-medium/30 bg-sev-medium/10 px-3 py-2 text-xs">
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-sev-medium" />
      <span>{children}</span>
    </div>
  );
}

function PolicyForm({ policy, onDone }: { policy: WorkforcePolicy | null; onDone: () => void }) {
  const [d, setD] = React.useState<PolicyDraft>(() => toDraft(policy));
  const [submitted, setSubmitted] = React.useState(false);
  const [netInput, setNetInput] = React.useState("");
  const [netError, setNetError] = React.useState<string | null>(null);
  const errors = React.useMemo(() => (submitted ? validateDraft(d) : {}), [d, submitted]);

  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const save = useApiMutation(
    (body: WorkforcePolicyInput) =>
      policy ? api.patch<WorkforcePolicy>(`/workforce/policies/${policy.id}`, body) : api.post<WorkforcePolicy>("/workforce/policies", body),
    {
      success: (_r, b) => (policy ? `Policy ${b.name} saved` : `Policy ${b.name} created`),
      invalidate: [["workforce", "policies"], ["workforce", "me"]],
      onSuccess: onDone,
    },
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validateDraft(d);
    if (Object.keys(errs).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-policy-form] [aria-invalid=true]")?.focus());
      return;
    }
    save.mutate(toBody(d));
  };

  const intField = (k: IntKey, label: string, unit: string, hint?: string) => (
    <Field label={label} htmlFor={`wp-${k}`} error={errors[k]} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id={`wp-${k}`}
          inputMode="numeric"
          value={d[k]}
          onChange={(e) => set(k, e.target.value.replace(/[^\d]/g, ""))}
          aria-invalid={!!errors[k]}
          className="h-8 w-24 tabular"
          min={INT_FIELDS[k].min}
          max={INT_FIELDS[k].max}
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </Field>
  );

  const toggle = (k: BoolKey, label: string, help?: React.ReactNode, children?: React.ReactNode) => (
    <ToggleRow id={`wp-${k}`} label={label} help={help} checked={d[k]} onChange={(v) => set(k, v)}>
      {children}
    </ToggleRow>
  );

  const tzList = React.useMemo(() => {
    const list = timezones();
    return list.includes(d.timezone) ? list : [d.timezone, ...list];
  }, [d.timezone]);

  const idleMin = Math.min(30, Math.max(2, Math.round(d.idleThresholdSec / 60)));
  const intervals = INTERVALS.includes(d.screenshotIntervalMin) ? INTERVALS : [...INTERVALS, d.screenshotIntervalMin].sort((a, b) => a - b);

  const addNetwork = () => {
    const v = netInput.trim();
    if (!v) return;
    const err = networkError(v);
    if (err) {
      setNetError(err);
      return;
    }
    if (d.officeNetworks.some((n) => n.toLowerCase() === v.toLowerCase())) {
      setNetError("Already in the list");
      return;
    }
    set("officeNetworks", [...d.officeNetworks, v]);
    setNetInput("");
    setNetError(null);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col" data-policy-form>
      <SheetBody className="grid grid-cols-1 content-start gap-4 pt-4">
        {/* General */}
        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4">
          <Field label="Name" htmlFor="wp-name" required error={errors.name}>
            <Input id="wp-name" value={d.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} placeholder="Standard office hours" />
          </Field>
          <Field label="Description" htmlFor="wp-description" error={errors.description}>
            <Textarea id="wp-description" rows={2} value={d.description} onChange={(e) => set("description", e.target.value)} aria-invalid={!!errors.description} />
          </Field>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor="wp-isDefault" className="text-sm font-medium">
                Default policy
              </label>
              <p className="text-xs text-muted-foreground">Applies to every employee whose department has no policy assigned. Only one policy can be the default.</p>
            </div>
            <Switch id="wp-isDefault" checked={d.isDefault} onCheckedChange={(v) => set("isDefault", v)} />
          </div>
        </div>

        {/* Schedule */}
        <Section title="Schedule" description="Local working hours in the policy's time zone. Lateness, half days and overtime are computed from these." icon={CalendarClock}>
          <div className="grid grid-cols-1 gap-4 px-4 py-3">
            <fieldset className="grid grid-cols-1 gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Workdays</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const checked = d.workDays.includes(w.iso);
                  const id = `wp-day-${w.iso}`;
                  return (
                    <label
                      key={w.iso}
                      htmlFor={id}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        checked ? "border-primary/50 bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        aria-label={w.long}
                        onCheckedChange={(v) =>
                          set("workDays", v ? [...d.workDays, w.iso].sort((a, b) => a - b) : d.workDays.filter((x) => x !== w.iso))
                        }
                      />
                      {w.short}
                    </label>
                  );
                })}
              </div>
              {errors.workDays && <p className="text-xs text-destructive">{errors.workDays}</p>}
            </fieldset>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Work start" htmlFor="wp-workStart" error={errors.workStart}>
                <Input id="wp-workStart" type="time" value={d.workStart} onChange={(e) => set("workStart", e.target.value)} aria-invalid={!!errors.workStart} className="h-8" />
              </Field>
              <Field label="Work end" htmlFor="wp-workEnd" error={errors.workEnd}>
                <Input id="wp-workEnd" type="time" value={d.workEnd} onChange={(e) => set("workEnd", e.target.value)} aria-invalid={!!errors.workEnd} className="h-8" />
              </Field>
              <Field label="Time zone" htmlFor="wp-timezone">
                <Select value={d.timezone} onValueChange={(v) => set("timezone", v)}>
                  <SelectTrigger id="wp-timezone" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {tzList.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {intField("graceMinutes", "Grace period", "min", "Late after start + grace.")}
              {intField("minDailyMinutes", "Minimum daily time", "min", "Below this counts as missing hours.")}
              {intField("halfDayMinutes", "Half day below", "min")}
              {intField("overtimeAfterMinutes", "Overtime after", "min")}
              {intField("maxBreakMinutes", "Max break", "min")}
            </div>
          </div>
          {toggle("trackingEnabled", "Tracking enabled", "When off, the agent collects no activity for employees on this policy (attendance via manual clock-in only).")}
          {toggle(
            "trackOutsideWorkHours",
            "Track outside work hours",
            "Off: nothing is collected outside workdays / work hours unless the employee clocks in manually.",
          )}
        </Section>

        {/* Activity */}
        <Section title="Activity" description="Only counts and categories — never keystroke content, clipboard or typed text." icon={MousePointerClick}>
          <div className="grid grid-cols-1 gap-2 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="wp-idle">Idle threshold</Label>
              <span className="text-sm font-semibold tabular">{idleMin} min</span>
            </div>
            <Slider
              id="wp-idle"
              min={2}
              max={30}
              step={1}
              value={[idleMin]}
              onValueChange={([v]) => set("idleThresholdSec", v * 60)}
              thumbLabel="Idle threshold in minutes"
            />
            <p className="text-xs text-muted-foreground">No keyboard or mouse input for this long marks the employee as idle. Idle time is treated neutrally.</p>
          </div>
          {toggle("trackApps", "Track applications", "Foreground application / process name and time spent.")}
          {toggle("trackWebsites", "Track websites", "Domain only (e.g. github.com), never the full URL, path or query.")}
          {toggle(
            "captureWindowTitles",
            "Capture window titles",
            "Titles may contain document names or personal information. Never sent to AI summaries.",
            d.captureWindowTitles ? <Warning>Window titles can reveal sensitive content. Enable only where you have a documented need.</Warning> : null,
          )}
        </Section>

        {/* Screenshots */}
        <Section title="Screenshots" description="Opt-in. Captured only while the employee is active during tracked hours; encrypted at rest; every view is audited." icon={Camera}>
          {toggle(
            "screenshotsEnabled",
            "Capture screenshots",
            "Off by default.",
            d.screenshotsEnabled ? (
              <Warning>
                Screenshots are highly privacy-invasive. Inform employees, keep blurring on where possible, and use the shortest retention you need.
              </Warning>
            ) : null,
          )}
          <div className={cn("grid gap-3 px-4 py-3", !d.screenshotsEnabled && "opacity-60")}>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Capture interval</legend>
              <div role="radiogroup" aria-label="Screenshot interval" className="grid grid-cols-3 gap-2 sm:max-w-md">
                {intervals.map((m) => {
                  const active = d.screenshotIntervalMin === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`Every ${m} minutes`}
                      disabled={!d.screenshotsEnabled}
                      onClick={() => set("screenshotIntervalMin", m)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                        active ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "hover:bg-accent",
                      )}
                    >
                      <div className="text-sm font-semibold tabular">{m} min</div>
                      <div className="text-[11px] text-muted-foreground">~{Math.round(60 / m)} / hour</div>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{intField("screenshotRetentionDays", "Retention", "days", "Deleted automatically afterwards.")}</div>
          </div>
          {toggle(
            "screenshotBlur",
            "Blur on device",
            "Screenshots are blurred on the employee's device before upload.",
            !d.screenshotBlur && d.screenshotsEnabled ? (
              <Warning>Unblurred screenshots show readable screen content (messages, documents, personal data). Keep blur on unless strictly required.</Warning>
            ) : null,
          )}
        </Section>

        {/* Location */}
        <Section title="Location" description="Office networks decide whether a day counts as Office or Remote." icon={MapPin}>
          <div className="grid grid-cols-1 gap-2 px-4 py-3">
            <Label htmlFor="wp-net">Office networks</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="wp-net"
                value={netInput}
                onChange={(e) => {
                  setNetInput(e.target.value);
                  setNetError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNetwork();
                  }
                }}
                placeholder="10.0.0.0/8, 2001:db8::/32 or ssid:Office-WiFi"
                aria-invalid={!!netError}
                className="h-8 min-w-0 flex-1 font-mono text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={addNetwork} disabled={!netInput.trim()}>
                <Plus /> Add
              </Button>
            </div>
            {netError ? (
              <p className="text-xs text-destructive">{netError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">IPv4/IPv6 addresses or CIDRs of office egress/LAN, or a Wi-Fi name as ssid:&lt;name&gt;.</p>
            )}
            {errors.officeNetworks && <p className="text-xs text-destructive">{errors.officeNetworks}</p>}
            {d.officeNetworks.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {d.officeNetworks.map((n) => (
                  <li key={n} className="flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5">
                    <span className="truncate font-mono text-xs">{n}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${n}`}
                      onClick={() => set("officeNetworks", d.officeNetworks.filter((x) => x !== n))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No office networks — every day is recorded as Remote/Unknown.</p>
            )}
          </div>
        </Section>

        {/* Discipline & alerts */}
        <Section title="Discipline & alerts" description="Work alerts raised for managers when thresholds are crossed. 0 disables a numeric alert." icon={AlarmClock}>
          {toggle("requireTaskSelection", "Require task selection", "Employees are reminded to pick the task they are working on.")}
          {toggle("requireDailyReport", "Require daily work report", "A missing report raises a work alert after the due time.")}
          <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Daily report due" htmlFor="wp-dailyReportDueTime" error={errors.dailyReportDueTime}>
              <Input
                id="wp-dailyReportDueTime"
                type="time"
                value={d.dailyReportDueTime}
                onChange={(e) => set("dailyReportDueTime", e.target.value)}
                aria-invalid={!!errors.dailyReportDueTime}
                className="h-8 w-32"
              />
            </Field>
            {intField("alertNoActivityMinutes", "No activity after clock-in", "min")}
            {intField("alertIdlePercent", "Idle above", "% of worked time")}
            {intField("alertOvertimeMinutes", "Overtime above", "min")}
            {intField("alertUnproductivePercent", "Unproductive above", "% of active time")}
          </div>
          {toggle("alertLateLogin", "Alert on late login", "Raised when the first activity is after start + grace.")}
        </Section>

        {/* Transparency */}
        <Section title="Transparency" description="Employees are always told they are being tracked." icon={Eye}>
          {toggle(
            "showTrackingNotice",
            "Show tracking notice",
            "The agent shows a desktop notification at the start of each tracked day, and the console shows the employee a banner.",
          )}
          {toggle("employeeCanSeeOwnData", "Employees can see their own data", "Own timeline, hours, productivity, own screenshots and own AI summary.")}
        </Section>
      </SheetBody>
      <SheetFooter>
        {submitted && Object.keys(errors).length > 0 && (
          <Badge tone="critical" className="self-center sm:mr-auto">
            {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? "" : "s"} need attention
          </Badge>
        )}
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {policy ? "Save policy" : "Create policy"}
        </Button>
      </SheetFooter>
    </form>
  );
}
