"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CardSkeleton, ErrorState } from "@/components/common/states";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ROLE_KEYS, type RoleKey, type SystemSettings } from "@/types/api";
import { roleMeta } from "@/components/users/role-meta";

type Kind = "integer" | "string" | "email" | "roles" | "boolean" | "number" | "json";

interface Spec {
  label: string;
  kind: Kind;
  hint?: string;
  min?: number;
  max?: number;
  unit?: string;
}

/** Known settings (mirrors backend validators). Unknown keys fall back to a generic editor by value type. */
const KNOWN: Record<string, Spec> = {
  sessionTimeoutMinutes: { label: "Session idle timeout", kind: "integer", min: 5, max: 1440, unit: "minutes", hint: "Console sessions expire after this much inactivity." },
  mfaRequiredRoles: { label: "MFA required for roles", kind: "roles", hint: "Users with these roles must enrol in MFA before using the console." },
  passwordExpiryDays: { label: "Password expiry", kind: "integer", min: 0, unit: "days", hint: "0 = passwords never expire." },
  deviceInactiveAfterHours: { label: "Mark device inactive after", kind: "integer", min: 1, max: 720, unit: "hours" },
  onlineThresholdMinutes: { label: "Online threshold", kind: "integer", min: 1, max: 1440, unit: "minutes", hint: "A device counts as online if it checked in within this window." },
  usbRequestMaxHours: { label: "Max USB access duration", kind: "integer", min: 1, max: 72, unit: "hours" },
  auditRetentionDays: { label: "Audit log retention", kind: "integer", min: 30, unit: "days" },
  reportRetentionDays: { label: "Generated report retention", kind: "integer", min: 1, unit: "days" },
  companyName: { label: "Organization name", kind: "string", max: 200, hint: "Shown in report headers and notification emails." },
  supportEmail: { label: "Support email", kind: "email", max: 200, hint: "Contact shown to employees in USB and compliance notices." },
};

const SECTIONS: { title: string; description: string; keys: string[] }[] = [
  { title: "Authentication & sessions", description: "Sign-in security for console users.", keys: ["sessionTimeoutMinutes", "passwordExpiryDays", "mfaRequiredRoles"] },
  { title: "Devices", description: "Agent connectivity and USB access limits.", keys: ["onlineThresholdMinutes", "deviceInactiveAfterHours", "usbRequestMaxHours"] },
  { title: "Data retention", description: "How long historical data is kept.", keys: ["auditRetentionDays", "reportRetentionDays"] },
  { title: "Organization", description: "Branding and contact details.", keys: ["companyName", "supportEmail"] },
];

function specFor(key: string, value: unknown): Spec {
  if (KNOWN[key]) return KNOWN[key];
  const label = humanize(key.replace(/([a-z])([A-Z])/g, "$1_$2"));
  if (typeof value === "boolean") return { label, kind: "boolean" };
  if (typeof value === "number") return { label, kind: "number" };
  if (typeof value === "string") return { label, kind: "string" };
  return { label, kind: "json", hint: "JSON value" };
}

/** Draft representation per kind: numbers and JSON are edited as text. */
function toDraft(kind: Kind, value: unknown): unknown {
  if (kind === "integer" || kind === "number") return value === null || value === undefined ? "" : String(value);
  if (kind === "json") return JSON.stringify(value ?? null, null, 2);
  if (kind === "roles") return Array.isArray(value) ? value : [];
  if (kind === "boolean") return !!value;
  return value ?? "";
}

function parseDraft(spec: Spec, draft: unknown): { value?: unknown; error?: string } {
  switch (spec.kind) {
    case "integer":
    case "number": {
      const s = String(draft).trim();
      if (s === "") return { error: "Required" };
      const n = Number(s);
      if (!Number.isFinite(n)) return { error: "Must be a number" };
      if (spec.kind === "integer" && !Number.isInteger(n)) return { error: "Must be a whole number" };
      if (spec.min !== undefined && n < spec.min) return { error: `Minimum ${spec.min}` };
      if (spec.max !== undefined && n > spec.max) return { error: `Maximum ${spec.max}` };
      return { value: n };
    }
    case "json":
      try {
        return { value: JSON.parse(String(draft)) };
      } catch {
        return { error: "Invalid JSON" };
      }
    case "email": {
      const s = String(draft).trim();
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { error: "Enter a valid email address" };
      return { value: s };
    }
    case "string": {
      const s = String(draft);
      if (spec.max !== undefined && s.length > spec.max) return { error: `At most ${spec.max} characters` };
      return { value: s };
    }
    default:
      return { value: draft };
  }
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SystemTab() {
  const { reload } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", "system"],
    queryFn: ({ signal }) => api.get<SystemSettings>("/settings", undefined, { signal }),
  });
  const server = React.useMemo(() => query.data ?? {}, [query.data]);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});

  const keys = Object.keys(server);
  const otherKeys = keys.filter((k) => !SECTIONS.some((s) => s.keys.includes(k)));

  const entries = keys.map((key) => {
    const spec = specFor(key, server[key]);
    const current = key in draft ? draft[key] : toDraft(spec.kind, server[key]);
    const parsed = parseDraft(spec, current);
    const changed = !parsed.error && !eq(parsed.value, server[key]);
    const touched = key in draft && !eq(current, toDraft(spec.kind, server[key]));
    return { key, spec, current, parsed, changed, touched };
  });
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
  const errors = entries.filter((e) => e.touched && e.parsed.error);
  const changed = entries.filter((e) => e.changed);

  const save = useApiMutation((body: Record<string, unknown>) => api.patch<SystemSettings>("/settings", body), {
    success: (_d, body) => `${Object.keys(body).length} setting${Object.keys(body).length === 1 ? "" : "s"} saved`,
    invalidate: [["settings", "system"]],
    onSuccess: (data, body) => {
      if (data && typeof data === "object") qc.setQueryData(["settings", "system"], data);
      setDraft({});
      if ("mfaRequiredRoles" in body) void reload();
    },
  });

  const onSave = () => {
    if (errors.length) return;
    save.mutate(Object.fromEntries(changed.map((e) => [e.key, e.parsed.value])));
  };

  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  if (query.isLoading) {
    return (
      <div className="grid max-w-4xl gap-4">
        <CardSkeleton className="h-40" />
        <CardSkeleton className="h-32" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card className="max-w-4xl">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const renderField = (key: string) => {
    const e = byKey[key];
    if (!e) return null;
    const { spec, current, parsed, touched } = e;
    const id = `sys-${key}`;
    const error = touched ? parsed.error : undefined;
    const label = (
      <span className="inline-flex items-center gap-1.5">
        {spec.label}
        {e.changed && <span className="size-1.5 rounded-full bg-primary" aria-label="Modified" />}
      </span>
    );

    switch (spec.kind) {
      case "roles": {
        const selected = new Set(current as RoleKey[]);
        return (
          <fieldset key={key} className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">{label}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ROLE_KEYS.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-accent/50">
                  <Checkbox
                    checked={selected.has(r)}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v === true) next.add(r);
                      else next.delete(r);
                      set(key, ROLE_KEYS.filter((k) => next.has(k)));
                    }}
                  />
                  {roleMeta[r].label}
                </label>
              ))}
            </div>
            {spec.hint && <p className="text-xs text-muted-foreground">{spec.hint}</p>}
          </fieldset>
        );
      }
      case "boolean":
        return (
          <div key={key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <Label htmlFor={id}>{label}</Label>
            <Switch id={id} checked={!!current} onCheckedChange={(v) => set(key, v)} />
          </div>
        );
      case "json":
        return (
          <Field key={key} label={label} htmlFor={id} error={error} hint={spec.hint} className="sm:col-span-2">
            <Textarea id={id} value={String(current)} onChange={(ev) => set(key, ev.target.value)} rows={4} className="font-mono text-xs" aria-invalid={!!error} />
          </Field>
        );
      case "integer":
      case "number":
        return (
          <Field
            key={key}
            label={label}
            htmlFor={id}
            error={error}
            hint={[spec.hint, spec.min !== undefined || spec.max !== undefined ? `Range: ${spec.min ?? "–"}–${spec.max ?? "∞"}` : null].filter(Boolean).join(" ")}
          >
            <div className="flex items-center gap-2">
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={spec.min}
                max={spec.max}
                step={spec.kind === "integer" ? 1 : "any"}
                value={String(current)}
                onChange={(ev) => set(key, ev.target.value)}
                className="w-32"
                aria-invalid={!!error}
              />
              {spec.unit && <span className="text-xs text-muted-foreground">{spec.unit}</span>}
            </div>
          </Field>
        );
      default:
        return (
          <Field key={key} label={label} htmlFor={id} error={error} hint={spec.hint}>
            <Input
              id={id}
              type={spec.kind === "email" ? "email" : "text"}
              value={String(current ?? "")}
              onChange={(ev) => set(key, ev.target.value)}
              maxLength={spec.max}
              aria-invalid={!!error}
            />
          </Field>
        );
    }
  };

  const sections = [
    ...SECTIONS.map((s) => ({ ...s, keys: s.keys.filter((k) => k in server) })),
    { title: "Other settings", description: "Additional keys stored on the server.", keys: otherKeys },
  ].filter((s) => s.keys.length > 0);

  return (
    <div className="grid max-w-4xl gap-4 pb-16">
      {sections.map((s) => (
        <Card key={s.title}>
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
            <CardDescription>{s.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">{s.keys.map(renderField)}</CardContent>
        </Card>
      ))}

      <div
        className={cn(
          "sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg transition-opacity sm:flex-row sm:items-center",
          changed.length === 0 && errors.length === 0 && "pointer-events-none opacity-0",
        )}
        aria-hidden={changed.length === 0 && errors.length === 0}
      >
        <p className="flex-1 text-sm">
          {errors.length > 0 ? (
            <span className="text-destructive">Fix {errors.length} invalid value{errors.length === 1 ? "" : "s"} before saving.</span>
          ) : (
            <>
              {changed.length} unsaved change{changed.length === 1 ? "" : "s"}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft({})} disabled={save.isPending}>
            <RotateCcw /> Discard
          </Button>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={errors.length > 0 || changed.length === 0}>
            {!save.isPending && <Save />} Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
