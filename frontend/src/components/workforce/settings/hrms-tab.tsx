"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, KeyRound, Save, Send, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CardSkeleton, ErrorState } from "@/components/common/states";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { HrmsSettings } from "@/types/api";

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PAYLOAD_EXAMPLE = `POST <webhookUrl>
Content-Type: application/json
Authorization: <your configured header value>
X-SEM-Signature: sha256=<hex HMAC-SHA256 of the raw body>

{
  "date": "2026-09-24",
  "records": [
    {
      "employeeEmail": "asha.rao@example.com",
      "employeeExternalId": "EMP-1042",
      "status": "PRESENT",
      "clockInAt": "2026-09-24T04:02:11.000Z",
      "clockOutAt": "2026-09-24T13:11:40.000Z",
      "workedMinutes": 512,
      "lateMinutes": 0,
      "overtimeMinutes": 0,
      "location": "OFFICE"
    }
  ]
}`;

type TestResult = { ok?: boolean; status?: number; statusCode?: number; message?: string } | null | undefined;

export function HrmsTab() {
  const q = useQuery({ queryKey: ["workforce", "hrms"], queryFn: () => api.get<HrmsSettings>("/workforce/hrms") });

  if (q.isLoading) return <CardSkeleton className="h-80" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <HrmsForm key={q.dataUpdatedAt} settings={q.data ?? null} />;
}

function HrmsForm({ settings }: { settings: HrmsSettings | null }) {
  const [enabled, setEnabled] = React.useState(!!settings?.enabled);
  const [webhookUrl, setWebhookUrl] = React.useState(settings?.webhookUrl ?? "");
  const [authHeader, setAuthHeader] = React.useState("");
  const [clearAuth, setClearAuth] = React.useState(false);
  const [sendDailyAt, setSendDailyAt] = React.useState(settings?.sendDailyAt || "06:00");
  const [submitted, setSubmitted] = React.useState(false);

  const authConfigured = !!settings?.authHeaderSet || (typeof settings?.authHeader === "string" && settings.authHeader.length > 0);
  const dirty =
    enabled !== !!settings?.enabled ||
    webhookUrl.trim() !== (settings?.webhookUrl ?? "") ||
    sendDailyAt !== (settings?.sendDailyAt || "06:00") ||
    authHeader.trim() !== "" ||
    clearAuth;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const url = webhookUrl.trim();
    if (enabled && !url) e.webhookUrl = "Required when the integration is enabled";
    else if (url) {
      try {
        if (new URL(url).protocol !== "https:") e.webhookUrl = "Must be an https:// URL";
      } catch {
        e.webhookUrl = "Enter a valid URL";
      }
    }
    if (!HM_RE.test(sendDailyAt)) e.sendDailyAt = "Use HH:mm";
    if (authHeader.length > 2000) e.authHeader = "Max 2000 characters";
    return e;
  };
  const errors = submitted ? validate() : {};

  const save = useApiMutation((body: Record<string, unknown>) => api.put<HrmsSettings>("/workforce/hrms", body), {
    success: "HRMS integration saved",
    invalidate: [["workforce", "hrms"]],
  });
  const test = useApiMutation(() => api.post<TestResult>("/workforce/hrms/test"), {
    success: (r) => {
      const code = r?.status ?? r?.statusCode;
      return r?.message ?? (code ? `Sample sent — HRMS responded ${code}` : "Sample payload sent to the HRMS endpoint");
    },
    errorTitle: "Test delivery failed",
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(validate()).length > 0) return;
    const url = webhookUrl.trim();
    const body: Record<string, unknown> = { enabled, webhookUrl: url || null, sendDailyAt };
    if (authHeader.trim()) body.authHeader = authHeader.trim();
    else if (clearAuth) body.authHeader = "";
    save.mutate(body, {
      onSuccess: () => {
        setAuthHeader("");
        setClearAuth(false);
      },
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <Card className="min-w-0">
        <CardHeader className="flex-row items-start gap-3 border-b pb-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Webhook className="size-4" />
          </div>
          <div className="grid grid-cols-1 min-w-0 flex-1 gap-1">
            <CardTitle>HRMS attendance export</CardTitle>
            <CardDescription>Once a day the previous day&apos;s closed attendance is POSTed as JSON to your HRMS / payroll system.</CardDescription>
          </div>
          <Badge tone={settings?.enabled ? "success" : "unknown"} dot>
            {settings?.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <label htmlFor="hrms-enabled" className="text-sm font-medium">
                  Send daily attendance
                </label>
                <p className="text-xs text-muted-foreground">When off, nothing is sent (Send test still works with the saved settings).</p>
              </div>
              <Switch id="hrms-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <Field label="Webhook URL" htmlFor="hrms-url" required={enabled} error={errors.webhookUrl} hint="HTTPS endpoint that accepts the JSON payload.">
              <Input
                id="hrms-url"
                type="url"
                inputMode="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hrms.example.com/api/attendance"
                aria-invalid={!!errors.webhookUrl}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  Authorization header
                  {authConfigured && !clearAuth && (
                    <Badge tone="success">
                      <KeyRound /> Configured
                    </Badge>
                  )}
                </span>
              }
              htmlFor="hrms-auth"
              error={errors.authHeader}
              hint={
                authConfigured
                  ? "Write-only. Leave blank to keep the stored value; type a new value to replace it."
                  : "Write-only value sent as the Authorization header, e.g. Bearer <token>."
              }
            >
              <Input
                id="hrms-auth"
                type="password"
                value={authHeader}
                onChange={(e) => setAuthHeader(e.target.value)}
                placeholder={authConfigured ? "•••••••• (unchanged)" : "Bearer …"}
                autoComplete="new-password"
                aria-invalid={!!errors.authHeader}
                disabled={clearAuth}
              />
            </Field>
            {authConfigured && (
              <label htmlFor="hrms-clear-auth" className="-mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox id="hrms-clear-auth" checked={clearAuth} onCheckedChange={(v) => setClearAuth(!!v)} />
                Remove the stored header on save
              </label>
            )}
            <Field label="Send daily at" htmlFor="hrms-time" error={errors.sendDailyAt} hint="Organization time zone.">
              <Input id="hrms-time" type="time" value={sendDailyAt} onChange={(e) => setSendDailyAt(e.target.value)} aria-invalid={!!errors.sendDailyAt} className="w-32" />
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => test.mutate()}
                loading={test.isPending}
                disabled={!settings?.webhookUrl}
                title={dirty ? "Tests use the saved settings — save first" : undefined}
              >
                <Send /> Send test
              </Button>
              <Button type="submit" loading={save.isPending} disabled={!dirty}>
                <Save /> Save
              </Button>
            </div>
            {dirty && settings?.webhookUrl && <p className="-mt-2 text-right text-[11px] text-muted-foreground">Send test uses the saved settings.</p>}
          </form>
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>Payload format</CardTitle>
          <CardDescription>What your HRMS receives.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-xs">
          <details className="group rounded-md border">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Example request
            </summary>
            <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">{PAYLOAD_EXAMPLE}</pre>
          </details>
          <ul className="grid grid-cols-1 list-disc gap-1.5 pl-4 text-muted-foreground marker:text-muted-foreground">
            <li>
              One request per day with the previous day&apos;s <span className="text-foreground">closed</span> sessions; <code className="font-mono">status</code> is
              PRESENT, LATE, HALF_DAY, ABSENT, ON_LEAVE, HOLIDAY or WEEKEND; <code className="font-mono">location</code> is OFFICE, REMOTE or UNKNOWN.
            </li>
            <li>
              <code className="font-mono">X-SEM-Signature</code> is <code className="font-mono">sha256=</code> + the hex HMAC-SHA256 of the raw request body.
              Verify it on the receiver (constant-time compare) before trusting the payload.
            </li>
            <li>Timestamps are ISO 8601 UTC; minutes are integers.</li>
            <li>Respond with a 2xx status to acknowledge delivery.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
