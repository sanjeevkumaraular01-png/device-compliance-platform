"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppWindow, ArrowRight, BellRing, Bot, ClipboardList, Coffee, EyeOff, LogIn, LogOut, Pause, Play, Sun, Timer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useConfirm } from "@/components/common/confirm-dialog";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatPercent } from "@/lib/format";
import { productiveTone } from "@/lib/status";
import { AppUsageTable, CategoryDonut, HourTimelineChart } from "@/components/workforce/activity-charts";
import { AiDisclaimer, EmployeeInsightView } from "@/components/workforce/ai-insight-view";
import { AttendanceBadge, LiveStatusBadge, LocationBadge, Metric, fmtClock, fmtHm, fmtMinutes, fmtTime, shiftDate, todayLocal, useElapsed } from "@/components/workforce/common";
import { useMyTasks, useWorkforceMe } from "@/components/workforce/queries";
import { useStartTimer, useStopTimer } from "@/components/workforce/task-timer";
import type { AiInsight, AppUsage, ClockAction, EmployeeInsight, HourBucket, Paginated, WorkSession, WorkforceMe } from "@/types/api";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function scheduleText(me: WorkforceMe | undefined): string | null {
  const p = me?.policy;
  if (!p) return null;
  const days = (p.workDays ?? []).map((d) => DAY_NAMES[d] ?? d).join(", ");
  return `${days} · ${p.workStart}–${p.workEnd} (${p.timezone})`;
}

function ClockControls({ me }: { me: WorkforceMe }) {
  const confirm = useConfirm();
  const clock = useApiMutation((type: ClockAction) => api.post<WorkSession>("/workforce/clock", { type }), {
    success: (_d, t) =>
      t === "CLOCK_IN" ? "Clocked in — have a good day" : t === "CLOCK_OUT" ? "Clocked out — tracking stopped" : t === "BREAK_START" ? "Break started" : "Welcome back",
    errorTitle: "Clock action failed",
    invalidate: [["workforce"]],
  });
  const today = me.today;
  const clockedOut = me.status === "CLOCKED_OUT" || !!today?.clockOutAt;
  const clockedIn = !!today?.clockInAt && !clockedOut;
  const onBreak = me.status === "ON_BREAK";
  const pending = (t: ClockAction) => clock.isPending && clock.variables === t;

  const onClockOut = async () => {
    const ok = await confirm({
      title: "Clock out for today?",
      description: "Activity tracking stops until your next clock-in or the next workday. You can still write your daily report.",
      confirmLabel: "Clock out",
    });
    if (ok) clock.mutate("CLOCK_OUT");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!clockedIn ? (
        <Button onClick={() => clock.mutate("CLOCK_IN")} loading={pending("CLOCK_IN")} disabled={clock.isPending}>
          <LogIn /> {clockedOut ? "Clock in again" : "Clock in"}
        </Button>
      ) : onBreak ? (
        <Button onClick={() => clock.mutate("BREAK_END")} loading={pending("BREAK_END")} disabled={clock.isPending}>
          <Play /> End break
        </Button>
      ) : (
        <Button variant="outline" onClick={() => clock.mutate("BREAK_START")} loading={pending("BREAK_START")} disabled={clock.isPending}>
          <Coffee /> Start break
        </Button>
      )}
      {clockedIn && (
        <Button variant="outline" onClick={() => void onClockOut()} loading={pending("CLOCK_OUT")} disabled={clock.isPending}>
          <LogOut /> Clock out
        </Button>
      )}
    </div>
  );
}

function TodayMetrics({ s }: { s: WorkSession | null }) {
  if (!s) {
    return <EmptyState compact icon={Sun} title="No activity yet today" description="Clock in, or start working — the agent records attendance automatically on your first activity." />;
  }
  const productivePct = s.activeSec > 0 ? (s.productiveSec / s.activeSec) * 100 : null;
  const tracked = s.activeSec + s.idleSec;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Metric label="Clock in" value={fmtTime(s.clockInAt ?? s.firstActivityAt)} sub={s.lateMinutes > 0 ? `${fmtMinutes(s.lateMinutes)} late` : "On time"} tone={s.lateMinutes > 0 ? "medium" : undefined} />
      <Metric label="Active" value={fmtHm(s.activeSec)} sub={`${formatPercent(tracked ? (s.activeSec / tracked) * 100 : 0, 0)} of tracked`} />
      <Metric label="Idle" value={fmtHm(s.idleSec)} sub={`${formatPercent(tracked ? (s.idleSec / tracked) * 100 : 0, 0)} of tracked`} />
      <Metric label="Productive" value={productivePct === null ? "—" : formatPercent(productivePct, 0)} sub={fmtHm(s.productiveSec)} tone={productiveTone(productivePct)} />
      <Metric label="Focus" value={fmtHm(s.focusSec)} sub="Streaks ≥ 25 min" />
      <Metric label="Meetings" value={fmtHm(s.meetingSec)} />
      <Metric label="Breaks" value={fmtHm(s.breakSec)} />
      <Metric label="Overtime" value={fmtMinutes(s.overtimeMinutes)} tone={s.overtimeMinutes > 0 ? "high" : undefined} />
      <Metric label="Missing" value={fmtMinutes(s.missingMinutes)} sub="vs. minimum daily" tone={s.missingMinutes > 0 ? "medium" : undefined} />
      <Metric label="Last activity" value={fmtTime(s.lastActivityAt)} sub={s.clockOutAt ? `Out ${fmtTime(s.clockOutAt)}` : undefined} />
    </div>
  );
}

function CurrentTaskCard({ me }: { me: WorkforceMe }) {
  const tasks = useMyTasks();
  const start = useStartTimer();
  const stop = useStopTimer();
  const running = me.runningTimer;
  const elapsed = useElapsed(running?.startedAt ?? null);
  const open = (tasks.data ?? []).filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  const [picked, setPicked] = React.useState<string | undefined>();
  const selectId = React.useId();

  return (
    <WidgetCard
      title="Current task"
      description={me.policy.requireTaskSelection ? "Your policy requires a task to be selected while you work." : "Time on the selected task is tracked automatically."}
      icon={Timer}
      action={
        <Button asChild variant="ghost" size="xs">
          <Link href="/workforce/tasks">
            All tasks <ArrowRight />
          </Link>
        </Button>
      }
    >
      {running ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sev-none/35 bg-sev-none/10 px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{running.task?.title ?? "Running task"}</div>
            {running.task?.project?.name && <div className="truncate text-xs text-muted-foreground">{running.task.project.name}</div>}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold tabular text-sev-none">{fmtClock(elapsed)}</span>
            <Button variant="outline" size="sm" onClick={() => stop.mutate()} loading={stop.isPending}>
              <Pause /> Stop
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground">No timer running.</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid grid-cols-1 min-w-0 flex-1 gap-1.5">
          <Label htmlFor={selectId}>{running ? "Switch to" : "Start working on"}</Label>
          <Select value={picked} onValueChange={setPicked} disabled={tasks.isLoading || open.length === 0}>
            <SelectTrigger id={selectId} size="sm">
              <SelectValue placeholder={tasks.isLoading ? "Loading tasks…" : open.length === 0 ? "No open tasks assigned to you" : "Select a task"} />
            </SelectTrigger>
            <SelectContent>
              {open.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                  {t.project?.name ? ` · ${t.project.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={!picked || picked === running?.taskId} loading={start.isPending} onClick={() => picked && start.mutate(picked, { onSuccess: () => setPicked(undefined) })}>
          <Play /> Start timer
        </Button>
      </div>
      {tasks.isError && <p className="mt-2 text-xs text-destructive">Could not load your tasks.</p>}
    </WidgetCard>
  );
}

function MyActivity({ userId, date }: { userId: string; date: string }) {
  const timeline = useQuery({
    queryKey: ["workforce", "timeline", userId, date],
    queryFn: () => api.get<HourBucket[]>(`/workforce/users/${userId}/timeline`, { date }),
    refetchInterval: 5 * 60_000,
  });
  const apps = useQuery({
    queryKey: ["workforce", "apps", userId, date],
    queryFn: async () => normalizeList(await api.get<AppUsage[] | Paginated<AppUsage>>(`/workforce/users/${userId}/apps`, { from: date, to: date })).data,
    refetchInterval: 5 * 60_000,
  });
  return (
    <>
      <WidgetCard title="Today, hour by hour" description="Minutes per hour: productive, neutral, unproductive and idle" icon={Sun} className="xl:col-span-3">
        {timeline.isLoading ? <Skeleton className="h-56" /> : timeline.isError ? <ErrorState compact error={timeline.error} onRetry={() => timeline.refetch()} /> : <HourTimelineChart buckets={timeline.data} />}
      </WidgetCard>
      <WidgetCard title="My apps & websites" description="Domains only — never page content or full URLs" icon={AppWindow} className="xl:col-span-2" contentClassName="grid grid-cols-1 gap-3">
        {apps.isLoading ? (
          <Skeleton className="h-56" />
        ) : apps.isError ? (
          <ErrorState compact error={apps.error} onRetry={() => apps.refetch()} />
        ) : (
          <>
            {(apps.data?.length ?? 0) > 0 && <CategoryDonut apps={apps.data ?? []} height={140} />}
            <div className="-mx-4 border-t">
              <AppUsageTable apps={apps.data ?? []} limit={10} maxHeight="18rem" />
            </div>
          </>
        )}
      </WidgetCard>
    </>
  );
}

function MyAiSummary({ userId }: { userId: string }) {
  const today = todayLocal();
  const yesterday = shiftDate(today, -1);
  const q = useQuery({
    queryKey: ["ai", "insights", "mine", userId, today],
    queryFn: async () => {
      const get = async (date: string) =>
        normalizeList(await api.get<AiInsight[] | Paginated<AiInsight>>("/ai/insights", { type: "EMPLOYEE_DAILY", userId, date })).data;
      const t = await get(today);
      const ready = t.find((i) => i.status === "READY");
      if (ready) return ready;
      const y = await get(yesterday);
      return y.find((i) => i.status === "READY") ?? t[0] ?? y[0] ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const insight = q.data as AiInsight<EmployeeInsight> | null | undefined;
  return (
    <WidgetCard title="My AI summary" description={insight ? `For ${insight.date?.slice(0, 10)}` : "Generated each evening from your tracked activity, tasks and report"} icon={Bot} className="xl:col-span-5">
      {q.isLoading ? (
        <Skeleton className="h-28" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} title="AI summary unavailable" />
      ) : !insight ? (
        <EmptyState compact icon={Bot} title="No AI summary yet" description="Your daily AI summary appears here after the evening run (only if AI insights are enabled for your organisation)." />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <EmployeeInsightView insight={insight} />
          <AiDisclaimer />
        </div>
      )}
    </WidgetCard>
  );
}

export function MyDay() {
  const { user } = useAuth();
  const me = useWorkforceMe();
  const date = todayLocal();
  const data = me.data;
  const canSeeOwn = data?.policy.employeeCanSeeOwnData !== false;

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <PageHeader
        className="mb-1"
        title="My Day"
        icon={Sun}
        description={scheduleText(data) ? `Your schedule: ${scheduleText(data)}` : "Your attendance, activity and tasks for today."}
        actions={data ? <ClockControls me={data} /> : null}
      />

      {data?.trackingNotice && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/10 px-3.5 py-2.5 text-sm">
          <BellRing className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="min-w-0">
            <p className="font-medium">Work activity tracking is on</p>
            <p className="whitespace-pre-line text-xs text-muted-foreground">{data.trackingNotice}</p>
          </div>
        </div>
      )}

      {me.isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : me.isError || !data ? (
        <Card>
          <ErrorState error={me.error} onRetry={() => me.refetch()} title="Could not load your day" />
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-1 gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <LiveStatusBadge status={data.status} />
              {data.today && <AttendanceBadge value={data.today.status} />}
              {data.today && <LocationBadge value={data.today.location} />}
              {data.policy.trackingEnabled === false && <span className="text-xs text-muted-foreground">Tracking is disabled by your policy.</span>}
            </div>
            <TodayMetrics s={data.today} />
          </Card>

          <div className="grid grid-cols-1 min-w-0 gap-4 lg:grid-cols-2">
            <CurrentTaskCard me={data} />
            <WidgetCard
              title="Daily work report"
              description={
                data.policy.requireDailyReport === false
                  ? "Optional for your team."
                  : `Due today${data.policy.dailyReportDueTime ? ` by ${data.policy.dailyReportDueTime}` : ""}.`
              }
              icon={ClipboardList}
            >
              <p className="text-sm text-muted-foreground">
                Summarize what you completed, results, pending work and blockers. You can pre-fill it from your tracked tasks and activity.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link href={`/workforce/reports?date=${date}`}>
                  <ClipboardList /> Open today&apos;s report
                </Link>
              </Button>
            </WidgetCard>
          </div>

          {canSeeOwn && user ? (
            <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-5">
              <MyActivity userId={user.id} date={date} />
              <MyAiSummary userId={user.id} />
            </div>
          ) : (
            <Card>
              <EmptyState compact icon={EyeOff} title="Detailed activity is hidden" description="Your organisation's policy does not show detailed activity on this page. Attendance and tasks remain available." />
            </Card>
          )}
          <p className="text-[11px] text-muted-foreground">
            What is collected: active/idle time, application names and website domains{data.policy.captureWindowTitles ? ", window titles" : ""}
            {data.policy.screenshotsEnabled ? `, and ${data.policy.screenshotBlur === false ? "" : "blurred "}screenshots while you are active` : ""}. Never keystrokes, typed text or
            page content.
          </p>
        </>
      )}
    </div>
  );
}
