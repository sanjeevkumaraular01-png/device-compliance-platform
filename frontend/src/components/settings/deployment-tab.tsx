"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Info, Save, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton, ErrorState, Forbidden } from "@/components/common/states";
import { Field, CopyButton } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { usePermission } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DeploySettings, DeploySettingsInput } from "@/types/api";

interface Draft {
  enabled: boolean;
  companyName: string;
  domainsText: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
}

function toDraft(s: DeploySettings): Draft {
  return {
    enabled: s.enabled,
    companyName: s.companyName ?? "",
    domainsText: (s.allowedDomains ?? []).join(", "),
    imapHost: s.imapHost ?? "",
    imapPort: String(s.imapPort ?? 993),
    imapSecure: s.imapSecure ?? true,
  };
}

function parseDomains(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,]+/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function DeploymentTab() {
  const canWrite = usePermission("settings:write");
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["deploy", "settings"],
    queryFn: ({ signal }) => api.get<DeploySettings>("/deploy/settings", undefined, { signal }),
    enabled: canWrite,
  });

  const [draft, setDraft] = React.useState<Draft | null>(null);
  React.useEffect(() => {
    if (query.data && draft === null) setDraft(toDraft(query.data));
  }, [query.data, draft]);

  const save = useApiMutation((body: DeploySettingsInput) => api.put<DeploySettings>("/deploy/settings", body), {
    success: "Deployment settings saved",
    invalidate: [["deploy", "settings"]],
    onSuccess: (data) => {
      if (data && typeof data === "object") {
        qc.setQueryData(["deploy", "settings"], data);
        setDraft(toDraft(data));
      }
    },
  });

  if (!canWrite) return <Forbidden />;

  if (query.isLoading || (draft === null && !query.isError)) {
    return (
      <div className="grid max-w-3xl gap-4">
        <CardSkeleton className="h-48" />
        <CardSkeleton className="h-32" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card className="max-w-3xl">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const server = query.data!;
  const d = draft!;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const parsedDomains = parseDomains(d.domainsText);
  const portNum = Number(d.imapPort);
  const portValid = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535;

  const next: DeploySettingsInput = {
    enabled: d.enabled,
    companyName: d.companyName.trim(),
    allowedDomains: parsedDomains,
    imapHost: d.imapHost.trim(),
    imapPort: portValid ? portNum : server.imapPort,
    imapSecure: d.imapSecure,
  };

  const current: DeploySettingsInput = {
    enabled: server.enabled,
    companyName: server.companyName ?? "",
    allowedDomains: server.allowedDomains ?? [],
    imapHost: server.imapHost ?? "",
    imapPort: server.imapPort,
    imapSecure: server.imapSecure,
  };

  const dirty = !eq(next, current);
  const canEnable = next.imapHost.length > 0;
  const enableBlocked = d.enabled && !canEnable;

  const onSave = () => {
    if (!portValid || enableBlocked) return;
    save.mutate(next);
  };

  return (
    <div className="grid max-w-3xl gap-4 pb-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Self-service enrollment
          </CardTitle>
          <CardDescription>
            Employees install the agent from the link below by signing in with their company email (verified over IMAP). Set the IMAP host to enable.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <div className="grid gap-0.5">
              <Label htmlFor="deploy-enabled">Enable self-service enrollment</Label>
              <span className="text-xs text-muted-foreground">Turn on the public /install page for employees.</span>
            </div>
            <Switch id="deploy-enabled" checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </div>
          {enableBlocked && (
            <p className="text-xs text-destructive">Set an IMAP host below before enabling self-service enrollment.</p>
          )}

          <Field label="Company name" htmlFor="deploy-company" hint="Shown to employees on the sign-in screen.">
            <Input id="deploy-company" value={d.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Acme Inc." maxLength={200} />
          </Field>

          <Field
            label="Allowed email domains"
            htmlFor="deploy-domains"
            hint="Comma-separated. Only employees whose email ends in one of these domains may enroll."
          >
            <Input
              id="deploy-domains"
              value={d.domainsText}
              onChange={(e) => set("domainsText", e.target.value)}
              placeholder="webyne.com, acme.com"
            />
          </Field>
          {parsedDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {parsedDomains.map((dom) => (
                <Badge key={dom} variant="secondary" className="gap-1 font-normal">
                  {dom}
                  <button
                    type="button"
                    aria-label={`Remove ${dom}`}
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => set("domainsText", parsedDomains.filter((x) => x !== dom).join(", "))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IMAP host" htmlFor="deploy-imap-host" hint="e.g. imap.gmail.com — required to enable.">
              <Input id="deploy-imap-host" value={d.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="imap.company.com" />
            </Field>
            <Field label="IMAP port" htmlFor="deploy-imap-port" error={!portValid ? "Enter a valid port (1–65535)" : undefined}>
              <Input
                id="deploy-imap-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                value={d.imapPort}
                onChange={(e) => set("imapPort", e.target.value)}
                className="w-32"
                aria-invalid={!portValid || undefined}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <div className="grid gap-0.5">
              <Label htmlFor="deploy-imap-secure">Use TLS (implicit SSL)</Label>
              <span className="text-xs text-muted-foreground">Recommended. Port 993 is the standard TLS IMAP port.</span>
            </div>
            <Switch id="deploy-imap-secure" checked={d.imapSecure} onCheckedChange={(v) => set("imapSecure", v)} />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/8 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <span>Employee passwords are only used once to verify identity over IMAP. They are never stored and never become a SecureEndpoint password.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
          <CardDescription>Share the install link with employees. The MSI is the same for everyone.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Employee install link</Label>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-xs">{server.installUrl}</code>
              <CopyButton value={server.installUrl} label="Copy link" className="self-start" />
              <Button variant="outline" size="icon-sm" asChild className="self-start" aria-label="Open install page">
                <a href={server.installUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Agent download (MSI)</Label>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-xs">{server.agentDownloadUrl}</code>
              <CopyButton value={server.agentDownloadUrl} label="Copy link" className="self-start" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1 text-xs">
            <span className="text-muted-foreground">Configuration status:</span>
            {server.configured ? (
              <Badge tone="success">Configured</Badge>
            ) : (
              <Badge tone="medium">Not configured — set the IMAP host</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending self-enrolled devices</CardTitle>
          <CardDescription>Devices enrolled through the install link land here awaiting approval, bound to the employee who signed in.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link href="/enrollment">
              Review pending devices <ExternalLink />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div
        className={cn(
          "sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg transition-opacity sm:flex-row sm:items-center",
          !dirty && "pointer-events-none opacity-0",
        )}
        aria-hidden={!dirty}
      >
        <p className="flex-1 text-sm">
          {enableBlocked ? (
            <span className="text-destructive">Set an IMAP host before enabling.</span>
          ) : !portValid ? (
            <span className="text-destructive">Fix the IMAP port before saving.</span>
          ) : (
            "You have unsaved changes"
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft(toDraft(server))} disabled={save.isPending}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={!dirty || !portValid || enableBlocked}>
            {!save.isPending && <Save />} Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
