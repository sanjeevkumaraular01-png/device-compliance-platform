"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, FileUp, Upload, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton, Field } from "@/components/common/misc";
import { fmtMinutes } from "@/components/workforce/common";
import { sourceLabel, TASK_INVALIDATE } from "@/components/workforce/tasks/task-cells";
import { IMPORT_COLUMNS, markDuplicates, parseImport } from "@/components/workforce/tasks/import-parse";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TASK_SOURCES, type TaskImportItem, type TaskSource } from "@/types/api";

const IMPORT_SOURCES = TASK_SOURCES.filter((s) => s !== "MANUAL");
const MAX_ITEMS = 1000;

const SAMPLE_CSV = `${IMPORT_COLUMNS.join(",")}
SUP-1042,"Printer offline, 3rd floor",Ticket from helpdesk,ekta@example.com,IT-OPS,60,2026-10-02,HIGH
SUP-1043,Reset VPN token,,ravi@example.com,,15,,MEDIUM`;

const EXAMPLE_BODY = `{
  "items": [
    {
      "externalRef": "DEAL-881",
      "title": "Follow up with Acme on renewal quote",
      "assigneeEmail": "sales.rep@example.com",
      "projectCode": "SALES-Q4",
      "estimatedMinutes": 45,
      "dueDate": "2026-10-01",
      "priority": "HIGH"
    }
  ]
}`;

/** Browser origin without a hydration mismatch (empty during SSR). */
function useOrigin(): string {
  return React.useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
}

type ImportResponse = Record<string, unknown> | null | undefined;

/** Pull well-known counters out of an unspecified import response (created/updated/skipped/errors…). */
function summarize(res: ImportResponse): { counts: { label: string; value: number }[]; errors: string[] } {
  const counts: { label: string; value: number }[] = [];
  const errors: string[] = [];
  if (!res || typeof res !== "object") return { counts, errors };
  const keys: [string, string][] = [
    ["received", "Received"],
    ["total", "Total"],
    ["created", "Created"],
    ["updated", "Updated"],
    ["unchanged", "Unchanged"],
    ["skipped", "Skipped"],
    ["failed", "Failed"],
  ];
  for (const [k, label] of keys) {
    const v = res[k];
    if (typeof v === "number") counts.push({ label, value: v });
    else if (Array.isArray(v)) counts.push({ label, value: v.length });
  }
  const errs = res.errors;
  if (typeof errs === "number") counts.push({ label: "Errors", value: errs });
  else if (Array.isArray(errs)) {
    counts.push({ label: "Errors", value: errs.length });
    for (const e of errs.slice(0, 50)) {
      if (typeof e === "string") errors.push(e);
      else if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        const where = o.externalRef ?? o.ref ?? (typeof o.index === "number" ? `#${o.index + 1}` : undefined);
        const msg = o.message ?? o.error ?? JSON.stringify(o);
        errors.push(where !== undefined ? `${String(where)}: ${String(msg)}` : String(msg));
      }
    }
  }
  return { counts, errors };
}

export function ImportTab() {
  const [source, setSource] = React.useState<TaskSource>("SUPPORT");
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<{ res: ImportResponse; sent: number } | null>(null);
  const parsed = React.useMemo(() => {
    const p = parseImport(text);
    return { ...p, rows: markDuplicates(p.rows) };
  }, [text]);
  const valid = parsed.rows.filter((r) => r.errors.length === 0);
  const invalid = parsed.rows.length - valid.length;
  const tooMany = valid.length > MAX_ITEMS;

  const importMut = useApiMutation(
    (v: { source: TaskSource; items: TaskImportItem[] }) => api.post<ImportResponse>("/tasks/import", v),
    {
      success: (_d, v) => `Imported ${formatNumber(v.items.length)} task${v.items.length === 1 ? "" : "s"} from ${sourceLabel(v.source)}`,
      errorTitle: "Import failed",
      invalidate: TASK_INVALIDATE,
      onSuccess: (res, v) => setResult({ res, sent: v.items.length }),
    },
  );

  const summary = result ? summarize(result.res) : null;
  const origin = useOrigin();
  const webhookUrl = `${origin}/api/v1/tasks/webhook/${source}`;
  const curl = `curl -X POST '${webhookUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-SEM-Task-Token: <token>' \\
  -d '${EXAMPLE_BODY.replace(/\n\s*/g, " ")}'`;

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" /> Import tasks
          </CardTitle>
          <CardDescription>
            Paste CSV (with a header row) or a JSON array. Tasks are upserted by source + external reference, so re-importing updates existing tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Source system" htmlFor="import-source" className="w-full sm:w-56">
              <Select value={source} onValueChange={(v) => setSource(v as TaskSource)}>
                <SelectTrigger id="import-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {sourceLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="button" variant="outline" size="sm" onClick={() => setText(SAMPLE_CSV)}>
              Insert sample CSV
            </Button>
          </div>
          <Field
            label="CSV or JSON"
            htmlFor="import-text"
            hint={
              <>
                CSV columns: <span className="break-all font-mono">{IMPORT_COLUMNS.join(",")}</span>. externalRef and title are required; priority is one of LOW, MEDIUM, HIGH, URGENT; dueDate as YYYY-MM-DD.
              </>
            }
          >
            <Textarea
              id="import-text"
              rows={8}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setResult(null);
              }}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={`${IMPORT_COLUMNS.join(",")}\nSUP-1042,Printer offline,,user@example.com,,60,2026-10-02,HIGH`}
            />
          </Field>

          {parsed.fatal && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {parsed.fatal}
            </p>
          )}

          {parsed.rows.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">Preview ({parsed.format?.toUpperCase()})</span>
                <Badge tone="success">{valid.length} valid</Badge>
                {invalid > 0 && <Badge tone="critical">{invalid} with errors (skipped)</Badge>}
                {tooMany && <Badge tone="high">Max {MAX_ITEMS} per import — split the file</Badge>}
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table containerClassName="max-h-80 scrollbar-thin">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>External ref</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Assignee</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Estimate</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Validation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.slice(0, 500).map((r) => (
                      <TableRow key={r.line} className={cn(r.errors.length > 0 && "bg-sev-critical/5")}>
                        <TableCell className="py-1.5 text-xs text-muted-foreground tabular">{r.line}</TableCell>
                        <TableCell className="py-1.5 font-mono text-xs">{r.item.externalRef || "—"}</TableCell>
                        <TableCell className="max-w-[240px] truncate py-1.5 text-xs" title={r.item.title}>
                          {r.item.title || "—"}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs">{r.item.assigneeEmail ?? "—"}</TableCell>
                        <TableCell className="py-1.5 font-mono text-xs">{r.item.projectCode ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs tabular">{r.item.estimatedMinutes !== undefined ? fmtMinutes(r.item.estimatedMinutes) : "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.item.dueDate ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{r.item.priority ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">
                          {r.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-sev-none">
                              <CheckCircle2 className="size-3.5" aria-hidden /> OK
                            </span>
                          ) : (
                            <span className="text-sev-critical">{r.errors.join("; ")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {parsed.rows.length > 500 && <p className="text-xs text-muted-foreground">Showing the first 500 of {parsed.rows.length} rows.</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {text && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText("");
                  setResult(null);
                }}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={valid.length === 0 || tooMany || !!parsed.fatal}
              loading={importMut.isPending}
              onClick={() => importMut.mutate({ source, items: valid.map((r) => r.item) })}
            >
              {!importMut.isPending && <Upload />} Import {valid.length > 0 ? formatNumber(valid.length) : ""} task{valid.length === 1 ? "" : "s"}
            </Button>
          </div>

          {result && summary && (
            <div role="status" className="rounded-md border border-sev-none/30 bg-sev-none/5 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4 text-sev-none" aria-hidden /> Import accepted
              </div>
              {summary.counts.length > 0 ? (
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                  {summary.counts.map((c) => (
                    <div key={c.label} className="flex items-baseline gap-1.5">
                      <dt className="text-xs text-muted-foreground">{c.label}</dt>
                      <dd className="font-semibold tabular">{formatNumber(c.value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{formatNumber(result.sent)} item(s) sent; the server did not return counts.</p>
              )}
              {summary.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-sev-critical">
                  {summary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-4 text-primary" /> Webhook for external systems
          </CardTitle>
          <CardDescription>
            CRMs, support desks and dev tools can push tasks directly. Same body as the import; one endpoint per source.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-xs">
          <div className="grid grid-cols-1 gap-1">
            <span className="font-medium">Endpoint ({sourceLabel(source)})</span>
            <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 py-1 pl-2 pr-1">
              <code className="min-w-0 flex-1 break-all font-mono text-[11px]">POST {webhookUrl}</code>
              <CopyButton value={webhookUrl} label="Copy webhook URL" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1">
            <span className="font-medium">Authentication header</span>
            <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]">X-SEM-Task-Token: &lt;token&gt;</code>
            <p className="text-muted-foreground">
              The token is the system setting <span className="font-mono">taskWebhookToken</span> (Settings → System). Treat it like a password and rotate it if it leaks.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Example</span>
              <CopyButton value={curl} label="Copy example curl command" />
            </div>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed scrollbar-thin">{curl}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
