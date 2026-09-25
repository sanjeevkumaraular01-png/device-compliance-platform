"use client";

import * as React from "react";
import { Activity, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badges";
import { fmtMinutes, Metric } from "@/components/workforce/common";
import { dailyReportStatusMeta, taskStatusMeta } from "@/lib/status";
import { formatDateTime } from "@/lib/format";
import type { DailyReportAutoDraft, DailyReportItemInput, DailyReportStatus, TaskStatus } from "@/types/api";

export function ReportStatusBadge({ value }: { value: DailyReportStatus | "MISSING" | null | undefined }) {
  return <StatusBadge value={value} meta={dailyReportStatusMeta} />;
}

/** Only render http(s) links as anchors (report text is user-provided). */
export function SafeLink({ href }: { href: string | null | undefined }) {
  const url = (href ?? "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return <span className="break-all">{url}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-primary hover:underline">
      <span className="min-w-0 break-all">{url}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{children}</dd>
    </div>
  );
}

/** Read-only card for one report item (labelled fields). */
export function ReportItemView({
  item,
  index,
  taskStatus,
}: {
  item: Partial<DailyReportItemInput>;
  index: number;
  taskStatus?: TaskStatus | null;
}) {
  return (
    <article className="rounded-lg border bg-card p-3" aria-label={`Item ${index + 1}`}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[11px] font-semibold tabular">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={item.taskTitle ?? undefined}>
          {item.taskTitle || "Untitled item"}
        </span>
        {taskStatus && <StatusBadge value={taskStatus} meta={taskStatusMeta} />}
        {typeof item.minutesSpent === "number" && item.minutesSpent > 0 && <Badge variant="outline">{fmtMinutes(item.minutesSpent)}</Badge>}
      </header>
      <dl className="grid grid-cols-1 gap-2">
        <Row label="Project">{item.projectName}</Row>
        <Row label="Work completed">{item.workCompleted}</Row>
        <Row label="Result">{item.result}</Row>
        <Row label="Pending work">{item.pendingWork}</Row>
        <Row label="Blocker">{item.blocker ? <span className="text-sev-high">{item.blocker}</span> : null}</Row>
        <Row label="Next action">{item.nextAction}</Row>
        <Row label="Evidence">{item.evidenceUrl ? <SafeLink href={item.evidenceUrl} /> : null}</Row>
      </dl>
    </article>
  );
}

/** Tracked-activity context of a report (from `autoDraft`). */
export function AutoDraftContext({ draft, className }: { draft: Partial<DailyReportAutoDraft> | null | undefined; className?: string }) {
  if (!draft) return null;
  const tasks = Array.isArray(draft.tasks) ? draft.tasks : [];
  const apps = Array.isArray(draft.topApps) ? draft.topApps : [];
  if (typeof draft.activeMinutes !== "number" && tasks.length === 0 && apps.length === 0) return null;
  const trackedOnTasks = tasks.reduce((n, t) => n + (t.minutes ?? 0), 0);
  return (
    <section className={className} aria-label="Tracked activity">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Activity className="size-3.5" aria-hidden /> Tracked activity
        {draft.generatedAt && <span className="font-normal normal-case tracking-normal">· {formatDateTime(draft.generatedAt)}</span>}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Active time" value={fmtMinutes(draft.activeMinutes ?? null)} />
        <Metric label="On tasks (timers)" value={fmtMinutes(trackedOnTasks)} sub={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`} />
      </div>
      {tasks.length > 0 && (
        <ul className="mt-2 divide-y rounded-md border text-xs">
          {tasks.map((t, i) => (
            <li key={`${t.taskId}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.taskTitle}</span>
                {t.projectName && <span className="block truncate text-[11px] text-muted-foreground">{t.projectName}</span>}
              </span>
              <span className="shrink-0 tabular">{fmtMinutes(t.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
      {apps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {apps.slice(0, 10).map((a, i) => (
            <Badge key={`${a.label}-${i}`} variant="outline" className="font-normal">
              {a.label} <span className="text-muted-foreground">{fmtMinutes(a.minutes)}</span>
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}
