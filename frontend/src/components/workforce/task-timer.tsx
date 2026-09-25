"use client";

import * as React from "react";
import Link from "next/link";
import { Pause, Play, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { fmtClock, useElapsed } from "@/components/workforce/common";
import { useWorkforceMe } from "@/components/workforce/queries";
import type { TimeEntry, WorkTask } from "@/types/api";

const TIMER_INVALIDATE = [["workforce"], ["tasks"]];

/** POST /tasks/:id/start — starts a timer (stops any running one) and makes it the agent's current task. */
export function useStartTimer() {
  return useApiMutation((taskId: string) => api.post<TimeEntry>(`/tasks/${taskId}/start`), {
    success: "Timer started",
    errorTitle: "Could not start the timer",
    invalidate: TIMER_INVALIDATE,
  });
}

/** POST /tasks/stop — stops the running timer. */
export function useStopTimer() {
  return useApiMutation(() => api.post<TimeEntry>("/tasks/stop"), {
    success: "Timer stopped",
    errorTitle: "Could not stop the timer",
    invalidate: TIMER_INVALIDATE,
  });
}

/** The currently running timer of the signed-in user (from `/workforce/me`). */
export function useRunningTimer(): TimeEntry | null {
  const me = useWorkforceMe();
  return me.data?.runningTimer ?? null;
}

/** Start/stop toggle for one task row. */
export function TaskTimerButton({ task, size = "xs" }: { task: Pick<WorkTask, "id" | "title" | "status">; size?: "xs" | "sm" }) {
  const running = useRunningTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const isRunning = running?.taskId === task.id;
  const elapsed = useElapsed(isRunning ? running?.startedAt : null);
  const closed = task.status === "DONE" || task.status === "CANCELLED";

  if (isRunning) {
    return (
      <Button
        variant="outline"
        size={size}
        onClick={(e) => {
          e.stopPropagation();
          stop.mutate();
        }}
        loading={stop.isPending}
        aria-label={`Stop timer for ${task.title}`}
        className="border-sev-none/40 text-sev-none"
      >
        <Pause /> <span className="font-mono tabular">{fmtClock(elapsed)}</span>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size={size}
      disabled={closed}
      onClick={(e) => {
        e.stopPropagation();
        start.mutate(task.id);
      }}
      loading={start.isPending && start.variables === task.id}
      aria-label={`Start timer for ${task.title}`}
    >
      <Play /> Start
    </Button>
  );
}

/** Compact running-timer chip for the top bar (hidden when no timer runs). */
export function RunningTimerIndicator() {
  const { can } = useAuth();
  const running = useRunningTimer();
  const stop = useStopTimer();
  const elapsed = useElapsed(running?.startedAt ?? null);
  if (!can("workforce:self") || !running) return null;
  const title = running.task?.title ?? "Task timer";
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-sev-none/35 bg-sev-none/10 pl-2 text-xs">
      <Link
        href="/workforce/tasks"
        className="flex min-w-0 items-center gap-1.5 py-1 text-sev-none hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Timer running for ${title}: ${fmtClock(elapsed)}. Open tasks`}
      >
        <Timer className="size-3.5 shrink-0 animate-pulse" />
        <span className="hidden max-w-[160px] truncate font-medium text-foreground 2xl:inline">{title}</span>
        <span className="font-mono tabular">{fmtClock(elapsed)}</span>
      </Link>
      <SimpleTooltip label="Stop timer">
        <Button variant="ghost" size="icon-xs" className={cn("text-sev-none")} onClick={() => stop.mutate()} loading={stop.isPending} aria-label="Stop timer">
          {!stop.isPending && <Pause />}
        </Button>
      </SimpleTooltip>
    </div>
  );
}
