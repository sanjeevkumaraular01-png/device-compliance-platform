"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AppWindow,
  Bot,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  ListTodo,
  PencilLine,
  Siren,
  Sun,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { SeverityBadge, StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { formatPercent, humanize } from "@/lib/format";
import { alertStatusMeta, dailyReportStatusMeta, productiveTone, taskStatusMeta, varianceTone, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import { AppUsageTable, CategoryDonut, HourTimelineChart } from "@/components/workforce/activity-charts";
import { AiDisclaimer, EmployeeInsightView } from "@/components/workforce/ai-insight-view";
import {
  AttendanceBadge,
  DateInput,
  LocationBadge,
  Metric,
  PersonCell,
  fmtHm,
  fmtMinutes,
  fmtTime,
  shiftDate,
  todayLocal,
} from "@/components/workforce/common";
import { useEmployeeDay } from "@/components/workforce/queries";
import { ScreenshotAuditNote, ScreenshotGallery } from "@/components/workforce/screenshot-gallery";
import type { ClockEvent, DailyWorkReport, EmployeeDay, WorkSession } from "@/types/api";

const CLOCK_LABEL: Record<string, string> = {
  CLOCK_IN: "Clock in",
  CLOCK_OUT: "Clock out",
  BREAK_START: "Break started",
  BREAK_END: "Break ended",
  LOCK: "Screen locked",
  UNLOCK: "Screen unlocked",
  LOGON: "Signed in",
  LOGOFF: "Signed out",
  SLEEP: "Sleep",
  WAKE: "Wake",
};

function SessionMetrics({ s }: { s: WorkSession }) {
  const tracked = s.activeSec + s.idleSec;
  const productivePct = s.activeSec > 0 ? (s.productiveSec / s.activeSec) * 100 : null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Clock in" value={fmtTime(s.clockInAt ?? s.firstActivityAt)} sub={s.lateMinutes > 0 ? `${fmtMinutes(s.lateMinutes)} late` : "On time"} tone={s.lateMinutes > 0 ? "medium" : undefined} />
      <Metric label="Clock out" value={fmtTime(s.clockOutAt)} sub={s.earlyLeaveMinutes > 0 ? `${fmtMinutes(s.earlyLeaveMinutes)} early` : `Last activity ${fmtTime(s.lastActivityAt)}`} tone={s.earlyLeaveMinutes > 0 ? "medium" : undefined} />
      <Metric label="Active" value={fmtHm(s.activeSec)} sub={`${formatPercent(tracked ? (s.activeSec / tracked) * 100 : 0, 0)} of tracked`} />
      <Metric label="Idle" value={fmtHm(s.idleSec)} sub={`${formatPercent(tracked ? (s.idleSec / tracked) * 100 : 0, 0)} of tracked`} />
      <Metric label="Productive" value={productivePct === null ? "—" : formatPercent(productivePct, 0)} sub={fmtHm(s.productiveSec)} tone={productiveTone(productivePct)} />
      <Metric label="Unproductive" value={fmtHm(s.unproductiveSec)} tone={s.unproductiveSec > 0 ? "medium" : undefined} />
      <Metric label="Focus" value={fmtHm(s.focusSec)} sub="Streaks ≥ 25 min" />
      <Metric label="Meetings" value={fmtHm(s.meetingSec)} />
      <Metric label="Breaks" value={fmtHm(s.breakSec)} />
      <Metric label="Overtime" value={fmtMinutes(s.overtimeMinutes)} tone={s.overtimeMinutes > 0 ? "high" : undefined} />
      <Metric label="Missing" value={fmtMinutes(s.missingMinutes)} tone={s.missingMinutes > 0 ? "medium" : undefined} />
      <Metric label="Neutral" value={fmtHm(s.neutralSec)} />
    </div>
  );
}

function ClockEventsList({ events }: { events: ClockEvent[] }) {
  if (events.length === 0) return <EmptyState compact icon={Clock} title="No clock events" description="Explicit clock-ins, breaks and lock/unlock events appear here." />;
  return (
    <ol className="grid grid-cols-1 gap-0">
      {events.map((e, i) => (
        <li key={e.id ?? i} className="relative flex gap-3 pb-3 last:pb-0">
          {i < events.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-0.5rem)] w-px bg-border" aria-hidden />}
          <span
            className={cn(
              "mt-1 size-[11px] shrink-0 rounded-full ring-2 ring-background",
              e.type === "CLOCK_IN" ? "bg-sev-none" : e.type === "CLOCK_OUT" ? "bg-sev-critical" : e.type.startsWith("BREAK") ? "bg-info" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="font-medium tabular">{fmtTime(e.occurredAt)}</span>
              <span>{CLOCK_LABEL[e.type] ?? humanize(e.type)}</span>
              <span className="text-[11px] text-muted-foreground">{e.source === "MANUAL_CORRECTION" ? "Correction" : humanize(e.source)}</span>
            </div>
            {e.note && <p className="break-words text-xs text-muted-foreground">{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TasksToday({ tasks }: { tasks: EmployeeDay["tasks"] }) {
  if (tasks.length === 0) return <EmptyState compact icon={ListTodo} title="No task time today" description="No timers ran and no activity was linked to a task." />;
  return (
    <Table containerStyle={{ maxHeight: "20rem" }}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Task</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Tracked today</TableHead>
          <TableHead className="text-right">Estimate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => {
          const est = t.estimatedMinutes ? t.estimatedMinutes * 60 : null;
          const variance = est ? ((t.trackedSecToday - est) / est) * 100 : null;
          return (
            <TableRow key={t.id}>
              <TableCell className="py-1.5">
                <div className="max-w-[260px]">
                  <div className="truncate font-medium" title={t.title}>
                    {t.title}
                  </div>
                  {t.projectName && <div className="truncate text-[11px] text-muted-foreground">{t.projectName}</div>}
                </div>
              </TableCell>
              <TableCell className="py-1.5">
                <StatusBadge value={t.status} meta={taskStatusMeta} />
              </TableCell>
              <TableCell className="py-1.5 text-right tabular">{fmtHm(t.trackedSecToday)}</TableCell>
              <TableCell className="py-1.5 text-right tabular">
                {t.estimatedMinutes ? (
                  <span title={variance !== null ? `${Math.round(variance)}% vs estimate (today only)` : undefined}>
                    {fmtMinutes(t.estimatedMinutes)}
                    {variance !== null && variance > 0 && <span className={cn("ml-1 text-[11px]", toneText[varianceTone(variance)])}>+{Math.round(variance)}%</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ReportView({ report }: { report: DailyWorkReport | null }) {
  if (!report || !report.id) {
    return <EmptyState compact icon={ClipboardList} title="No daily report" description="The employee has not written a report for this day." />;
  }
  const items = report.items ?? [];
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge value={report.status} meta={dailyReportStatusMeta} />
        {report.submittedAt && (
          <span className="text-muted-foreground">
            Submitted <RelativeTime value={report.submittedAt} />
          </span>
        )}
        {report.reviewer && <span className="text-muted-foreground">Reviewed by {report.reviewer.displayName}</span>}
      </div>
      {report.reviewNote && <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs">Review note: {report.reviewNote}</p>}
      {report.summary && <p className="whitespace-pre-line text-sm">{report.summary}</p>}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No items.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-2">
          {items.map((it, i) => (
            <li key={it.id ?? i} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {i + 1}. {it.taskTitle}
                </span>
                <span className="text-xs text-muted-foreground">
                  {it.projectName ?? ""}
                  {it.minutesSpent ? ` · ${fmtMinutes(it.minutesSpent)}` : ""}
                </span>
              </div>
              <dl className="mt-1.5 grid grid-cols-1 gap-1 text-xs sm:grid-cols-[8rem_1fr]">
                <dt className="text-muted-foreground">Work completed</dt>
                <dd className="break-words">{it.workCompleted}</dd>
                <dt className="text-muted-foreground">Result</dt>
                <dd className="break-words">{it.result}</dd>
                {it.pendingWork && (
                  <>
                    <dt className="text-muted-foreground">Pending</dt>
                    <dd className="break-words">{it.pendingWork}</dd>
                  </>
                )}
                {it.blocker && (
                  <>
                    <dt className="text-sev-high">Blocker</dt>
                    <dd className="break-words">{it.blocker}</dd>
                  </>
                )}
                {it.nextAction && (
                  <>
                    <dt className="text-muted-foreground">Next action</dt>
                    <dd className="break-words">{it.nextAction}</dd>
                  </>
                )}
                {it.evidenceUrl && (
                  <>
                    <dt className="text-muted-foreground">Evidence</dt>
                    <dd className="min-w-0">
                      {/^https?:\/\//i.test(it.evidenceUrl) ? (
                        <a href={it.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary hover:underline">
                          <span className="truncate">{it.evidenceUrl}</span> <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="break-words">{it.evidenceUrl}</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DayContent({ day, userId, date }: { day: EmployeeDay; userId: string; date: string }) {
  const { can, user } = useAuth();
  const s = day.session;
  const canScreens = can("workforce:screenshots") || user?.id === userId;
  const alerts = day.alerts ?? [];
  return (
    <>
      <Card className="grid grid-cols-1 gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {s ? (
            <>
              <AttendanceBadge value={s.status} />
              <LocationBadge value={s.location} />
              {s.isManuallyAdjusted && (
                <SimpleTooltip label={s.adjustmentNote ?? "Manually corrected"}>
                  <Badge tone="neutral" tabIndex={0}>
                    <PencilLine /> Adjusted
                  </Badge>
                </SimpleTooltip>
              )}
              {s.closedAt ? <span className="text-xs text-muted-foreground">Day closed</span> : <span className="text-xs text-muted-foreground">Live — updates as activity arrives</span>}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No work session for this day.</span>
          )}
        </div>
        {s && <SessionMetrics s={s} />}
      </Card>

      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-5">
        <WidgetCard title="Hour by hour" description="Minutes per hour by category, plus idle" icon={Sun} className="xl:col-span-3">
          <HourTimelineChart buckets={day.timeline} />
        </WidgetCard>
        <WidgetCard title="Category split" description="Tracked app & website time" icon={AppWindow} className="xl:col-span-2">
          {(day.apps ?? []).length > 0 ? <CategoryDonut apps={day.apps} /> : <EmptyState compact title="No app usage" />}
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-5">
        <WidgetCard title="Apps & websites" description="Domains only — never full URLs" icon={AppWindow} className="xl:col-span-3" contentClassName="px-0 pb-0">
          <AppUsageTable apps={day.apps ?? []} />
        </WidgetCard>
        <WidgetCard title="Clock events" icon={Clock} className="xl:col-span-2">
          <ClockEventsList events={day.clockEvents ?? []} />
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-2">
        <WidgetCard title="Tasks" description="Tracked time today vs. allocated estimate" icon={ListTodo} contentClassName="px-0 pb-0">
          <TasksToday tasks={day.tasks ?? []} />
        </WidgetCard>
        <WidgetCard title="Daily work report" icon={ClipboardList}>
          <ReportView report={day.report} />
        </WidgetCard>
      </div>

      {canScreens && (
        <WidgetCard
          title="Screenshots"
          description={`${day.screenshotsCount ?? 0} captured`}
          icon={Camera}
          action={
            can("workforce:screenshots") ? (
              <Button asChild variant="ghost" size="xs">
                <Link href={`/workforce/screenshots?userId=${userId}&date=${date}`}>Open gallery</Link>
              </Button>
            ) : undefined
          }
          contentClassName="grid grid-cols-1 gap-2"
        >
          {(day.screenshotsCount ?? 0) > 0 ? (
            <ScreenshotGallery userId={userId} date={date} variant="strip" canDelete={user?.role === "SUPER_ADMIN" || user?.id === userId} />
          ) : (
            <EmptyState compact icon={Camera} title="No screenshots" description="Screenshots are off unless the employee's workforce policy enables them." />
          )}
          <ScreenshotAuditNote />
        </WidgetCard>
      )}

      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-5">
        <WidgetCard title="AI insight" icon={Bot} className="xl:col-span-3">
          {day.aiInsight ? (
            <div className="grid grid-cols-1 gap-3">
              <EmployeeInsightView insight={day.aiInsight} />
              <AiDisclaimer />
            </div>
          ) : (
            <EmptyState compact icon={Bot} title="No AI insight for this day" description="Insights are generated nightly when AI is enabled, or on demand from AI Insights." />
          )}
        </WidgetCard>
        <WidgetCard title="Workforce alerts" icon={Siren} className="xl:col-span-2">
          {alerts.length === 0 ? (
            <EmptyState compact icon={Siren} title="No alerts" description="No workforce alerts were raised for this day." />
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {alerts.map((a) => (
                <li key={a.id} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge value={a.severity} />
                    <StatusBadge value={a.status} meta={alertStatusMeta} />
                    {a.ruleKey && <span className="font-mono text-[11px] text-muted-foreground">{a.ruleKey}</span>}
                  </div>
                  <div className="mt-1 text-sm font-medium">{a.title}</div>
                  {a.message && <p className="break-words text-xs text-muted-foreground">{a.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>
    </>
  );
}

export function EmployeeDayView({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = todayLocal();
  const raw = searchParams.get("date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const setDate = (d: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (d === today) p.delete("date");
    else p.set("date", d);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const q = useEmployeeDay(userId, date);
  const person = q.data?.user;
  useBreadcrumbLabel(person?.displayName);

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <PageHeader
        className="mb-1"
        title={person ? <PersonCell name={person.displayName} sub={[person.jobTitle, person.department?.name, person.email].filter(Boolean).join(" · ")} size="md" /> : "Employee day"}
        icon={person ? undefined : UserRound}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
              <ChevronLeft />
            </Button>
            <DateInput value={date} onChange={setDate} max={today} label="Day" />
            <Button variant="outline" size="icon-sm" aria-label="Next day" disabled={date >= today} onClick={() => setDate(shiftDate(date, 1))}>
              <ChevronRight />
            </Button>
            {date !== today && (
              <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
                Today
              </Button>
            )}
          </div>
        }
      />
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : q.isError && !q.data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load this employee's day" />
        </Card>
      ) : q.data ? (
        <div className={cn("grid min-w-0 gap-4 transition-opacity", q.isFetching && "opacity-80")}>
          <DayContent day={q.data} userId={userId} date={date} />
        </div>
      ) : null}
    </div>
  );
}
