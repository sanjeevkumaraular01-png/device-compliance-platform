"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, History, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { MonitoringNotice } from "@/types/api";

/** Starting point only — HR must make it match what is actually enabled before publishing. */
const TEMPLATE_TITLE = "Company device management notice";
const TEMPLATE_BODY = `This laptop is company property and is managed by [Company] IT using SecureEndpoint Manager.

What is collected from this device:
• Device details: name, model, serial number, operating system and hardware.
• Security status: antivirus, firewall, disk encryption, Secure Boot and missing updates.
• Installed software (names and versions) and USB storage events, to enforce company security policy.

[Edit this list so it matches exactly what your organization has enabled.]

Why: to keep company data secure, meet compliance obligations and support you with IT issues.
Who can see it: authorized IT and HR staff only. Access is logged.
How long it is kept: [retention period].
Your rights: you can ask HR to see the data held about you or raise a concern at [contact email].

By signing below you confirm you have read and understood this notice.`;

export function NoticeTab() {
  const { can } = useAuth();
  const canPublish = can("settings:write");
  const confirm = useConfirm();

  const current = useQuery({
    queryKey: ["hr", "notice"],
    queryFn: ({ signal }) => api.get<{ notice: MonitoringNotice | null }>("/hr/notice", undefined, { signal }),
  });
  const history = useQuery({
    queryKey: ["hr", "notice", "history"],
    queryFn: ({ signal }) => api.get<MonitoringNotice[]>("/hr/notice/history", undefined, { signal }),
  });

  const notice = current.data?.notice ?? null;
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");

  const startEdit = () => {
    setTitle(notice?.title ?? TEMPLATE_TITLE);
    setBody(notice?.body ?? TEMPLATE_BODY);
    setEditing(true);
  };

  const publish = useApiMutation((input: { title: string; body: string }) => api.put<MonitoringNotice>("/hr/notice", input), {
    success: (n) => `Notice version ${n?.version} published`,
    invalidate: [["hr"]],
    onSuccess: () => setEditing(false),
  });

  const onPublish = async () => {
    if (/\[[^\]]+\]/.test(body) || /\[[^\]]+\]/.test(title)) {
      await confirm({
        title: "Fill in the placeholders first",
        description: "The text still contains [square-bracket] placeholders. Replace them with your real details before publishing.",
        confirmLabel: "OK",
      });
      return;
    }
    const ok = await confirm({
      title: notice ? `Publish version ${notice.version + 1}?` : "Publish the monitoring notice?",
      description: notice
        ? "Every employee will need to read and sign the new version. Existing signatures stay on record for the old version."
        : "From now on, employees must read and sign this notice on the install page before they can install the agent.",
      confirmLabel: "Publish",
    });
    if (ok) publish.mutate({ title: title.trim(), body: body.trim() });
  };

  return (
    <div className="grid max-w-3xl gap-4">
      {!notice && !editing && !current.isLoading && (
        <div className="flex items-start gap-2 rounded-md border border-sev-medium/30 bg-sev-medium/10 px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            No monitoring notice is published yet, so employees can install the agent without signing anything. Publish a notice so every employee is
            informed and their acknowledgement is recorded.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="size-4 text-primary" /> {editing ? "Edit notice" : (notice?.title ?? "Monitoring notice")}
            </CardTitle>
            <CardDescription>
              {editing
                ? "Publishing creates a new version. Old versions are never changed, so each signature points to the exact text the employee saw."
                : notice
                  ? `Version ${notice.version} · published ${formatDateTime(notice.createdAt)}`
                  : "Shown on the install page before an employee can download the agent."}
            </CardDescription>
          </div>
          {canPublish && !editing && (
            <Button size="sm" onClick={startEdit}>
              {notice ? "Edit (new version)" : "Write notice"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid gap-3">
              <Field label="Title" htmlFor="notice-title">
                <Input id="notice-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Notice text" htmlFor="notice-body" hint="Plain text. Line breaks are kept.">
                <Textarea id="notice-body" rows={16} value={body} onChange={(e) => setBody(e.target.value)} className="text-sm" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={publish.isPending}>
                  Cancel
                </Button>
                <Button onClick={() => void onPublish()} loading={publish.isPending} disabled={title.trim().length < 3 || body.trim().length < 20}>
                  Publish
                </Button>
              </div>
            </div>
          ) : notice ? (
            <div className="whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm leading-relaxed">{notice.body}</div>
          ) : (
            <p className="text-sm text-muted-foreground">{current.isLoading ? "Loading…" : "Nothing published yet."}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" /> Version history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!history.data?.length ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <ul className="grid gap-2">
              {history.data.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">v{v.version}</span> · <span className="truncate">{v.title}</span>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(v.createdAt)}
                      {v.createdBy ? ` · by ${v.createdBy.displayName}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {v.version === notice?.version && <Badge tone="success">Current</Badge>}
                    <Badge variant="secondary">{v._count?.acknowledgements ?? 0} signed</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
