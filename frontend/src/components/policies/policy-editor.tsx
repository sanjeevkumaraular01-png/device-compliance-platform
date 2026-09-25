"use client";

import * as React from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Database,
  FileCog,
  Lock,
  MonitorSmartphone,
  PackageCheck,
  RefreshCcw,
  Save,
  ShieldCheck,
  Undo2,
  Usb,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import type { DevicePolicy } from "@/types/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { cn } from "@/lib/utils";
import {
  CHECKIN_OPTIONS,
  INVENTORY_OPTIONS,
  TOGGLES,
  formatInterval,
  pickEditable,
  type BoolKey,
  type PolicyEditable,
} from "@/components/policies/policy-fields";

// ───────────────────────────── Schema ─────────────────────────────

const int = (min: number, max: number, unit = "") =>
  z
    .number({ invalid_type_error: "Enter a number", required_error: "Required" })
    .int("Whole numbers only")
    .min(min, `Minimum ${min}${unit}`)
    .max(max, `Maximum ${max}${unit}`);

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Max 100 characters"),
  description: z.string().max(500, "Max 500 characters"),
  priority: int(0, 10000),
  companyDataOnlyManaged: z.boolean(),
  usbStorageBlocked: z.boolean(),
  allowWhitelistedUsb: z.boolean(),
  usbReadOnly: z.boolean(),
  blockUnauthorizedSoftware: z.boolean(),
  autoUninstallBlacklisted: z.boolean(),
  requireAntivirus: z.boolean(),
  requireEdr: z.boolean(),
  requireFirewall: z.boolean(),
  requireDiskEncryption: z.boolean(),
  requireSecureBoot: z.boolean(),
  maxAvSignatureAgeDays: int(1, 30, " days"),
  autoUpdateEnabled: z.boolean(),
  autoPatchDeployment: z.boolean(),
  patchDeadlineDays: int(1, 180, " days"),
  maintenanceWindow: z
    .string()
    .max(100, "Max 100 characters")
    .refine((v) => {
      const t = v.trim();
      if (!t) return true;
      const parts = t.split(/\s+/);
      return parts.length === 5 || parts.length === 6;
    }, "Use a 5-field cron expression, e.g. 0 2 * * 6"),
  screenLockEnabled: z.boolean(),
  screenLockTimeoutSec: int(60, 3600, " s"),
  requirePasswordOnWake: z.boolean(),
  screenSaverEnforced: z.boolean(),
  checkinIntervalSec: int(30, 86400, " s"),
  inventoryIntervalSec: int(300, 604800, " s"),
});

type FormValues = z.infer<typeof schema>;

function toForm(p: DevicePolicy): FormValues {
  const e = pickEditable(p);
  return { ...e, description: e.description ?? "", maintenanceWindow: e.maintenanceWindow ?? "" };
}

function toBody(v: FormValues): PolicyEditable {
  return {
    ...v,
    name: v.name.trim(),
    description: v.description.trim() || null,
    maintenanceWindow: v.maintenanceWindow.trim() || null,
  };
}

// ───────────────────────────── Sections ─────────────────────────────

export const POLICY_SECTIONS = [
  { id: "general", title: "General", icon: FileCog },
  { id: "data-access", title: "Data access", icon: Database },
  { id: "usb", title: "USB control", icon: Usb },
  { id: "software", title: "Software control", icon: PackageCheck },
  { id: "protection", title: "Endpoint protection", icon: ShieldCheck },
  { id: "updates", title: "Updates & patching", icon: RefreshCcw },
  { id: "screen-lock", title: "Screen lock", icon: Lock },
  { id: "agent", title: "Agent", icon: Bot },
  { id: "assignment", title: "Assignment", icon: Users },
] as const;

function Section({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader className="flex-row items-start gap-3 border-b pb-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="grid min-w-0 gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="divide-y p-0">{children}</CardContent>
    </Card>
  );
}

function RuleChips({ rules }: { rules?: string[] }) {
  if (!rules?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">Compliance rule:</span>
      {rules.map((r) => (
        <Badge key={r} tone="neutral" className="font-mono text-[10px]">
          {r}
        </Badge>
      ))}
    </div>
  );
}

function Row({
  label,
  htmlFor,
  help,
  rules,
  control,
  dimmed,
  className,
}: {
  label: string;
  htmlFor: string;
  help: React.ReactNode;
  rules?: string[];
  control: React.ReactNode;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6", dimmed && "opacity-60", className)}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{help}</p>
        <RuleChips rules={rules} />
      </div>
      <div className="shrink-0 sm:pt-0.5">{control}</div>
    </div>
  );
}

function ToggleRow({ name, control, disabled, dimmed }: { name: BoolKey; control: Control<FormValues>; disabled: boolean; dimmed?: boolean }) {
  const def = TOGGLES[name];
  const id = `pol-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Row
          label={def.label}
          htmlFor={id}
          help={def.help}
          rules={def.rules}
          dimmed={dimmed}
          control={
            <div className="flex items-center gap-2">
              <span className={cn("w-14 text-right text-xs font-medium", field.value ? "text-primary" : "text-muted-foreground")}>
                {field.value ? "Enforced" : "Off"}
              </span>
              <Switch id={id} checked={field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} disabled={disabled} />
            </div>
          }
        />
      )}
    />
  );
}

function IntervalSelect({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  options: number[];
  disabled: boolean;
}) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger id={id} className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {all.map((o) => (
          <SelectItem key={o} value={String(o)}>
            {formatInterval(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function formatMinutes(sec: number) {
  const m = sec / 60;
  if (m >= 60) return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m} min`;
}

// ───────────────────────────── Editor ─────────────────────────────

export function PolicyEditor({ policy, readOnly, assignment }: { policy: DevicePolicy; readOnly: boolean; assignment?: React.ReactNode }) {
  const qc = useQueryClient();
  const defaults = React.useMemo(() => toForm(policy), [policy]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults, mode: "onBlur" });
  const { register, control, handleSubmit, formState, reset } = form;
  const { errors, isDirty, dirtyFields } = formState;
  const dirtyCount = Object.keys(dirtyFields).length;

  const [usbBlocked, lockEnabled, requireAv] = useWatch({ control, name: ["usbStorageBlocked", "screenLockEnabled", "requireAntivirus"] });

  const save = useApiMutation((body: PolicyEditable) => api.patch<DevicePolicy>(`/policies/${policy.id}`, body), {
    success: (p) => `Policy saved — version ${p.version}, applied to affected devices`,
    invalidate: [["policies"], ["devices"], ["compliance"], ["dashboard"]],
    onSuccess: (p) => {
      qc.setQueryData(["policies", "detail", policy.id], p);
      reset(toForm(p));
    },
  });

  // Warn before leaving with unsaved edits.
  React.useEffect(() => {
    if (!isDirty || readOnly) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, readOnly]);

  const onSubmit = (v: FormValues) => save.mutate(toBody(v));
  const disabled = readOnly || save.isPending;

  const numberInput = (name: "priority" | "maxAvSignatureAgeDays" | "patchDeadlineDays", suffix: string, min: number, max: number) => (
    <div className="flex items-center gap-2">
      <Input
        id={`pol-${name}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className={cn("w-24 text-right tabular", errors[name] && "border-destructive")}
        disabled={disabled}
        aria-invalid={!!errors[name]}
        {...register(name, { valueAsNumber: true })}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );

  const errorText = (name: keyof FormValues) =>
    errors[name]?.message ? <span className="mt-1 block text-destructive">{errors[name]?.message}</span> : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[190px_minmax(0,1fr)]">
      <nav aria-label="Policy sections" className="hidden xl:block">
        <ul className="sticky top-20 grid gap-0.5 text-sm">
          {POLICY_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <s.icon className="size-4" />
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid min-w-0 gap-4">
        <form id="policy-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <Section id="general" title="General" icon={FileCog} description="Identification and ordering of this policy.">
            <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field label="Name" htmlFor="pol-name" required error={errors.name?.message}>
                <Input id="pol-name" disabled={disabled} {...register("name")} />
              </Field>
              <Field label="Priority" htmlFor="pol-priority" error={errors.priority?.message}>
                <Input
                  id="pol-priority"
                  type="number"
                  inputMode="numeric"
                  className="tabular"
                  disabled={disabled}
                  {...register("priority", { valueAsNumber: true })}
                />
              </Field>
              <Field label="Description" htmlFor="pol-description" error={errors.description?.message} className="sm:col-span-2">
                <Textarea id="pol-description" rows={2} disabled={disabled} {...register("description")} />
              </Field>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                {policy.isDefault ? (
                  <>
                    <Badge tone="primary">Default policy</Badge>
                    Applied to every device without a device- or department-level policy. It cannot be deleted.
                  </>
                ) : (
                  <>
                    <Badge tone="neutral">Not default</Badge>
                    Applies only to devices and departments explicitly assigned below.
                  </>
                )}
              </div>
            </div>
          </Section>

          <Section id="data-access" title="Data access" icon={Database} description="Conditional access to corporate data.">
            <ToggleRow name="companyDataOnlyManaged" control={control} disabled={disabled} />
          </Section>

          <Section id="usb" title="USB control" icon={Usb} description="Removable storage enforcement performed by the agent.">
            <ToggleRow name="usbStorageBlocked" control={control} disabled={disabled} />
            <ToggleRow name="allowWhitelistedUsb" control={control} disabled={disabled} dimmed={!usbBlocked} />
            <ToggleRow name="usbReadOnly" control={control} disabled={disabled} />
          </Section>

          <Section id="software" title="Software control" icon={PackageCheck} description="Application allow-listing and blacklist remediation.">
            <ToggleRow name="blockUnauthorizedSoftware" control={control} disabled={disabled} />
            <ToggleRow name="autoUninstallBlacklisted" control={control} disabled={disabled} />
          </Section>

          <Section id="protection" title="Endpoint protection" icon={ShieldCheck} description="Security controls that must be active for the device to be compliant.">
            <ToggleRow name="requireAntivirus" control={control} disabled={disabled} />
            <Row
              label="Maximum antivirus signature age"
              htmlFor="pol-maxAvSignatureAgeDays"
              help={<>Signatures older than this are reported as outdated.{errorText("maxAvSignatureAgeDays")}</>}
              rules={["ANTIVIRUS_OUTDATED"]}
              dimmed={!requireAv}
              control={numberInput("maxAvSignatureAgeDays", "days", 1, 30)}
            />
            <ToggleRow name="requireEdr" control={control} disabled={disabled} />
            <ToggleRow name="requireFirewall" control={control} disabled={disabled} />
            <ToggleRow name="requireDiskEncryption" control={control} disabled={disabled} />
            <ToggleRow name="requireSecureBoot" control={control} disabled={disabled} />
          </Section>

          <Section id="updates" title="Updates & patching" icon={RefreshCcw} description="Operating system updates and patch deployment.">
            <ToggleRow name="autoUpdateEnabled" control={control} disabled={disabled} />
            <ToggleRow name="autoPatchDeployment" control={control} disabled={disabled} />
            <Row
              label="Critical patch deadline"
              htmlFor="pol-patchDeadlineDays"
              help={<>Critical patches missing for longer than this after release make the device non-compliant.{errorText("patchDeadlineDays")}</>}
              rules={["CRITICAL_PATCHES_MISSING"]}
              control={numberInput("patchDeadlineDays", "days", 1, 180)}
            />
            <div className="grid gap-1.5 px-4 py-3">
              <label htmlFor="pol-maintenanceWindow" className="text-sm font-medium">
                Maintenance window <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="pol-maintenanceWindow"
                placeholder="0 2 * * 6"
                className={cn("max-w-xs font-mono text-xs", errors.maintenanceWindow && "border-destructive")}
                disabled={disabled}
                aria-invalid={!!errors.maintenanceWindow}
                {...register("maintenanceWindow")}
              />
              {errors.maintenanceWindow ? (
                <p className="text-xs text-destructive">{errors.maintenanceWindow.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Cron expression (minute hour day-of-month month day-of-week) in device local time, e.g.{" "}
                  <code className="font-mono">0 2 * * 6</code> = Saturdays at 02:00. Leave empty to allow installs at any time.
                </p>
              )}
            </div>
          </Section>

          <Section id="screen-lock" title="Screen lock" icon={Lock} description="Protect unattended devices.">
            <ToggleRow name="screenLockEnabled" control={control} disabled={disabled} />
            <Controller
              control={control}
              name="screenLockTimeoutSec"
              render={({ field }) => (
                <div className={cn("grid gap-2 px-4 py-3", !lockEnabled && "opacity-60")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="pol-screenLockTimeoutSec" className="text-sm font-medium">
                      Inactivity timeout
                    </label>
                    <span className="text-sm font-semibold tabular text-primary">{formatMinutes(field.value)}</span>
                  </div>
                  <Slider
                    id="pol-screenLockTimeoutSec"
                    min={60}
                    max={3600}
                    step={60}
                    value={[field.value]}
                    onValueChange={([v]) => field.onChange(v)}
                    disabled={disabled}
                    thumbLabel="Screen lock timeout"
                  />
                  <div className="flex justify-between text-[11px] text-muted-foreground tabular">
                    <span>1 min</span>
                    <span>15 min</span>
                    <span>30 min</span>
                    <span>45 min</span>
                    <span>60 min</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Devices whose configured lock timeout exceeds this value fail the screen-lock check. Recommended: 5 minutes.
                  </p>
                  <RuleChips rules={["SCREEN_LOCK_DISABLED"]} />
                </div>
              )}
            />
            <ToggleRow name="requirePasswordOnWake" control={control} disabled={disabled} dimmed={!lockEnabled} />
            <ToggleRow name="screenSaverEnforced" control={control} disabled={disabled} />
          </Section>

          <Section id="agent" title="Agent" icon={Bot} description="How often the endpoint agent reports to the console.">
            <Controller
              control={control}
              name="checkinIntervalSec"
              render={({ field }) => (
                <Row
                  label="Check-in interval"
                  htmlFor="pol-checkinIntervalSec"
                  help="Heartbeat frequency: picks up commands and policy changes. Shorter intervals increase server load."
                  control={<IntervalSelect id="pol-checkinIntervalSec" value={field.value} onChange={field.onChange} options={CHECKIN_OPTIONS} disabled={disabled} />}
                />
              )}
            />
            <Controller
              control={control}
              name="inventoryIntervalSec"
              render={({ field }) => (
                <Row
                  label="Inventory interval"
                  htmlFor="pol-inventoryIntervalSec"
                  help="Full hardware, software, patch and security posture collection."
                  control={<IntervalSelect id="pol-inventoryIntervalSec" value={field.value} onChange={field.onChange} options={INVENTORY_OPTIONS} disabled={disabled} />}
                />
              )}
            />
          </Section>
        </form>

        {assignment && (
          <div id="assignment" className="scroll-mt-20">
            {assignment}
          </div>
        )}

        {!readOnly && isDirty && (
          <div className="sticky bottom-3 z-20">
            <div className="flex flex-col gap-2 rounded-lg border bg-popover/95 px-4 py-2.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/85 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full bg-sev-medium" aria-hidden />
                <span className="font-medium">Unsaved changes</span>
                <span className="text-xs text-muted-foreground">
                  {dirtyCount} setting{dirtyCount === 1 ? "" : "s"} · saving creates v{policy.version + 1}
                </span>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => reset(defaults)} disabled={save.isPending} className="flex-1 sm:flex-none">
                  <Undo2 /> Discard
                </Button>
                <Button type="submit" form="policy-form" size="sm" loading={save.isPending} className="flex-1 sm:flex-none">
                  <Save /> Save policy
                </Button>
              </div>
            </div>
          </div>
        )}

        {readOnly && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MonitorSmartphone className="size-3.5" /> Read-only view — your role does not include <span className="font-mono">policies:write</span>.
          </p>
        )}
      </div>
    </div>
  );
}
