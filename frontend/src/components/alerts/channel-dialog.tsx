"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { alertSeverityMeta } from "@/lib/status";
import { humanize } from "@/lib/format";
import { ChannelTypeIcon, channelTypeMeta, maskedValue } from "@/components/alerts/channel-meta";
import {
  ALERT_CATEGORIES,
  ALERT_CHANNEL_TYPES,
  ALERT_SEVERITIES,
  type AlertChannel,
  type AlertChannelInput,
  type AlertChannelType,
} from "@/types/api";

const E164 = /^\+[1-9]\d{6,14}$/;
const emailCheck = z.string().email();

function splitList(s: string): string[] {
  return s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isHttpUrl(s: string, httpsOnly = false) {
  try {
    const u = new URL(s);
    return httpsOnly ? u.protocol === "https:" : u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function makeSchema(editing: boolean) {
  return z
    .object({
      name: z.string().trim().min(1, "Name is required").max(100),
      type: z.enum(ALERT_CHANNEL_TYPES),
      minSeverity: z.enum(ALERT_SEVERITIES),
      categories: z.array(z.enum(ALERT_CATEGORIES)).min(1, "Select at least one category"),
      enabled: z.boolean(),
      list: z.string(),
      url: z.string().trim(),
      secret: z.string(),
    })
    .superRefine((v, ctx) => {
      const entered = !!(v.list.trim() || v.url || v.secret.trim());
      if (editing && !entered) return; // keep the stored configuration
      switch (v.type) {
        case "EMAIL": {
          const items = splitList(v.list);
          if (items.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["list"], message: "Enter at least one email address" });
          const bad = items.filter((x) => !emailCheck.safeParse(x).success);
          if (bad.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["list"], message: `Invalid email: ${bad.slice(0, 3).join(", ")}` });
          break;
        }
        case "SMS":
        case "WHATSAPP": {
          const items = splitList(v.list);
          if (items.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["list"], message: "Enter at least one phone number" });
          const bad = items.filter((x) => !E164.test(x));
          if (bad.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["list"], message: `Use E.164 format (+14155550123): ${bad.slice(0, 3).join(", ")}` });
          break;
        }
        case "SLACK":
        case "TEAMS":
          if (!isHttpUrl(v.url, true)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Enter the https:// incoming webhook URL" });
          break;
        case "WEBHOOK":
          if (!isHttpUrl(v.url)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Enter a valid http(s):// URL" });
          if (v.secret && v.secret.length < 16) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["secret"], message: "Use at least 16 characters" });
          break;
      }
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

function buildConfig(v: FormValues): Record<string, unknown> {
  switch (v.type) {
    case "EMAIL":
      return { recipients: splitList(v.list) };
    case "SMS":
      return { provider: "twilio", to: splitList(v.list) };
    case "WHATSAPP":
      return { to: splitList(v.list) };
    case "SLACK":
    case "TEAMS":
      return { webhookUrl: v.url };
    case "WEBHOOK":
      return v.secret ? { url: v.url, secret: v.secret } : { url: v.url };
  }
}

function toForm(c?: AlertChannel | null): FormValues {
  return {
    name: c?.name ?? "",
    type: c?.type ?? "EMAIL",
    minSeverity: c?.minSeverity ?? "HIGH",
    categories: c?.categories?.length ? c.categories : [...ALERT_CATEGORIES],
    enabled: c?.enabled ?? true,
    list: "",
    url: "",
    secret: "",
  };
}

const SEVERITY_DESC = [...ALERT_SEVERITIES].reverse();

export function ChannelDialog({ open, onOpenChange, channel }: { open: boolean; onOpenChange: (o: boolean) => void; channel: AlertChannel | null }) {
  const editing = !!channel;
  const schema = React.useMemo(() => makeSchema(editing), [editing]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(channel) });
  const errors = form.formState.errors;
  const type = form.watch("type") as AlertChannelType;
  const categories = form.watch("categories");

  React.useEffect(() => {
    if (open) form.reset(toForm(channel));
  }, [open, channel, form]);

  const mutation = useApiMutation(
    (body: AlertChannelInput) => (channel ? api.patch<AlertChannel>(`/alerts/channels/${channel.id}`, body) : api.post<AlertChannel>("/alerts/channels", body)),
    {
      success: editing ? "Channel updated" : "Notification channel created",
      invalidate: [["alerts", "channels"]],
      onSuccess: () => onOpenChange(false),
    },
  );

  const onSubmit = form.handleSubmit((v) => {
    const entered = !!(v.list.trim() || v.url || v.secret.trim());
    const body: AlertChannelInput = {
      name: v.name,
      type: v.type,
      minSeverity: v.minSeverity,
      categories: v.categories,
      enabled: v.enabled,
    };
    if (!editing || entered) body.config = buildConfig(v);
    mutation.mutate(body);
  });

  // Masked values from the API, shown as placeholders only.
  const masked = channel?.config ?? null;
  const maskedList = masked ? maskedValue(type === "EMAIL" ? masked.recipients : masked.to) : "";
  const maskedUrl = masked ? maskedValue(type === "WEBHOOK" ? masked.url : masked.webhookUrl) : "";
  const hasMaskedSecret = !!masked && masked.secret !== undefined && masked.secret !== null && masked.secret !== "";

  const listMode = type === "EMAIL" || type === "SMS" || type === "WHATSAPP";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit channel · ${channel.name}` : "Add notification channel"}</DialogTitle>
          <DialogDescription>Alerts at or above the minimum severity in the selected categories are delivered to this channel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="ch-name" error={errors.name?.message} required>
              <Input id="ch-name" placeholder="SOC on-call" aria-invalid={!!errors.name || undefined} {...form.register("name")} />
            </Field>
            <Field label="Type" htmlFor="ch-type" hint={editing ? "The type of an existing channel cannot be changed" : channelTypeMeta[type]?.description} required>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    disabled={editing}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue("list", "");
                      form.setValue("url", "");
                      form.setValue("secret", "");
                      form.clearErrors(["list", "url", "secret"]);
                    }}
                  >
                    <SelectTrigger id="ch-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALERT_CHANNEL_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          <ChannelTypeIcon type={t} className="size-4 text-muted-foreground" />
                          {channelTypeMeta[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Lock className="size-3.5" /> Destination
            </div>
            {editing && (
              <p className="-mt-1 text-xs text-muted-foreground">
                Configuration is stored encrypted and is write-only — current values are shown masked. Leave these fields empty to keep the current
                configuration, or re-enter the complete configuration to replace it.
              </p>
            )}
            {listMode && (
              <Field
                label={type === "EMAIL" ? "Recipients" : "Phone numbers"}
                htmlFor="ch-list"
                error={errors.list?.message}
                hint={type === "EMAIL" ? "Separate addresses with commas or new lines" : "E.164 format, e.g. +14155550123 — one per line or comma-separated"}
                required={!editing}
              >
                <Textarea
                  id="ch-list"
                  rows={3}
                  className="font-mono text-xs"
                  placeholder={maskedList || (type === "EMAIL" ? "soc@example.com, it-oncall@example.com" : "+14155550123")}
                  aria-invalid={!!errors.list || undefined}
                  {...form.register("list")}
                />
              </Field>
            )}
            {!listMode && (
              <Field
                label={type === "WEBHOOK" ? "Endpoint URL" : "Incoming webhook URL"}
                htmlFor="ch-url"
                error={errors.url?.message}
                required={!editing}
                hint={type === "SLACK" ? "Slack → Apps → Incoming Webhooks" : type === "TEAMS" ? "Teams channel → Connectors / Workflows → Incoming webhook" : undefined}
              >
                <Input
                  id="ch-url"
                  type="url"
                  className="font-mono text-xs"
                  autoComplete="off"
                  placeholder={maskedUrl || "https://"}
                  aria-invalid={!!errors.url || undefined}
                  {...form.register("url")}
                />
              </Field>
            )}
            {type === "WEBHOOK" && (
              <Field label="Signing secret" htmlFor="ch-secret" error={errors.secret?.message} hint="Optional. Requests carry an HMAC-SHA256 signature in X-SEM-Signature.">
                <Input
                  id="ch-secret"
                  type="password"
                  autoComplete="new-password"
                  className="font-mono text-xs"
                  placeholder={hasMaskedSecret ? "•••• stored" : "Optional"}
                  {...form.register("secret")}
                />
              </Field>
            )}
          </div>

          <Field label="Minimum severity" htmlFor="ch-severity" hint="Alerts below this severity are not sent">
            <Controller
              control={form.control}
              name="minSeverity"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="ch-severity" className="sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_DESC.map((s) => (
                      <SelectItem key={s} value={s}>
                        {alertSeverityMeta[s].label} and above
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <div role="group" aria-labelledby="ch-cat-label" className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span id="ch-cat-label" className="text-sm font-medium">Categories</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => form.setValue("categories", [...ALERT_CATEGORIES], { shouldValidate: true })}>
                  All
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => form.setValue("categories", [], { shouldValidate: true })}>
                  None
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ALERT_CATEGORIES.map((c) => {
                const checked = categories.includes(c);
                return (
                  <div key={c} className="flex items-center gap-2">
                    <Checkbox
                      id={`ch-cat-${c}`}
                      checked={checked}
                      onCheckedChange={(v) => {
                        const next = v ? [...categories, c] : categories.filter((x) => x !== c);
                        form.setValue("categories", ALERT_CATEGORIES.filter((x) => next.includes(x)), { shouldValidate: true });
                      }}
                    />
                    <Label htmlFor={`ch-cat-${c}`} className="text-sm font-normal">
                      {humanize(c)}
                    </Label>
                  </div>
                );
              })}
            </div>
            {errors.categories?.message && <p className="text-xs text-destructive">{errors.categories.message}</p>}
          </div>

          <Separator />
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-muted-foreground">Disabled channels keep their configuration but receive nothing</div>
            </div>
            <Controller control={form.control} name="enabled" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Channel enabled" />} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? "Save changes" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
