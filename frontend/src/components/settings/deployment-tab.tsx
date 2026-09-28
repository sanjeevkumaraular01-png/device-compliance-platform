"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Info, Save, ShieldCheck } from "lucide-react";
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
}

function toDraft(s: DeploySettings): Draft {
  return { enabled: s.enabled, companyName: s.companyName ?? "" };
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

  const next: DeploySettingsInput = { enabled: d.enabled, companyName: d.companyName.trim() };
  const current: DeploySettingsInput = { enabled: server.enabled, companyName: server.companyName ?? "" };
  const dirty = !eq(next, current);

  const onSave = () => save.mutate(next);

  return (
    <div className="grid max-w-3xl gap-4 pb-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Self-service enrollment
          </CardTitle>
          <CardDescription>
            Employees install the agent from the link below by entering their <strong>Employee ID</strong>. Every self-enrolled device is bound to that
            employee and waits for admin approval.
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

          <Field label="Company name" htmlFor="deploy-company" hint="Shown to employees on the enrollment screen.">
            <Input id="deploy-company" value={d.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Acme Inc." maxLength={200} />
          </Field>

          <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/8 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <span>
              Each employee must have an Employee ID set on their user record (Users → edit → Employee ID). The Employee ID is not a password, so admin
              approval of every self-enrolled device is what secures the flow.
            </span>
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
            {server.configured ? <Badge tone="success">Enabled</Badge> : <Badge tone="medium">Disabled</Badge>}
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
        <p className="flex-1 text-sm">You have unsaved changes</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft(toDraft(server))} disabled={save.isPending}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={!dirty}>
            {!save.isPending && <Save />} Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
