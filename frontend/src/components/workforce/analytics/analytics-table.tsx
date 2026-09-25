"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BarChart3 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { PercentBar, PersonCell, fmtDay, fmtHours } from "@/components/workforce/common";
import { toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { WorkforceAnalyticsRow } from "@/types/api";

export const GROUP_BY = ["employee", "department", "project", "task", "day"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const GROUP_LABEL: Record<GroupBy, string> = {
  employee: "Employee",
  department: "Department",
  project: "Project",
  task: "Task",
  day: "Day",
};

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function HoursCell({ value, tone }: { value: number | null | undefined; tone?: "info" }) {
  const v = num(value);
  return <span className={cn("whitespace-nowrap", v > 0 && tone ? toneText[tone] : v === 0 && "text-muted-foreground")}>{fmtHours(v)}</span>;
}

export function AnalyticsTable({
  rows,
  groupBy,
  loading,
  fetching,
  error,
  onRetry,
  from,
  to,
}: {
  rows: WorkforceAnalyticsRow[];
  groupBy: GroupBy;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  onRetry: () => void;
  from: string;
  to: string;
}) {
  const columns = React.useMemo<ColumnDef<WorkforceAnalyticsRow, unknown>[]>(
    () => [
      {
        id: "label",
        accessorFn: (r) => r.label ?? "",
        header: GROUP_LABEL[groupBy],
        enableHiding: false,
        meta: { label: GROUP_LABEL[groupBy] },
        cell: ({ row }) => {
          const r = row.original;
          if (groupBy === "employee") {
            return <PersonCell className="min-w-[170px] max-w-[260px]" name={r.label || "Unknown"} href={r.key ? `/workforce/people/${r.key}?date=${to}` : undefined} />;
          }
          const text = groupBy === "day" ? fmtDay(r.label || r.key, "EEE, MMM d, yyyy") : r.label || "—";
          return (
            <span className="block min-w-[140px] max-w-[280px] truncate font-medium" title={r.label}>
              {text}
            </span>
          );
        },
      },
      {
        id: "activePercent",
        accessorFn: (r) => num(r.activePercent),
        header: "Active %",
        meta: { label: "Active %" },
        cell: ({ row }) => <PercentBar value={row.original.activePercent} tone="primary" label={`${row.original.label} active percentage`} />,
      },
      {
        id: "productivePercent",
        accessorFn: (r) => num(r.productivePercent),
        header: "Productive %",
        meta: { label: "Productive %" },
        cell: ({ row }) => <PercentBar value={row.original.productivePercent} label={`${row.original.label} productive percentage`} />,
      },
      {
        id: "idlePercent",
        accessorFn: (r) => num(r.idlePercent),
        header: "Idle %",
        meta: { label: "Idle %", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => {
          const v = row.original.idlePercent;
          return v === null || v === undefined ? "—" : <span className={cn(v >= 30 && toneText.medium)}>{Math.round(v)}%</span>;
        },
      },
      {
        id: "focusHours",
        accessorFn: (r) => num(r.focusHours),
        header: "Focus",
        meta: { label: "Focus hours", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <HoursCell value={row.original.focusHours} />,
      },
      {
        id: "meetingHours",
        accessorFn: (r) => num(r.meetingHours),
        header: "Meetings",
        meta: { label: "Meeting hours", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <HoursCell value={row.original.meetingHours} />,
      },
      {
        id: "activeHours",
        accessorFn: (r) => num(r.activeHours),
        header: "Active",
        meta: { label: "Active hours", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <span className="font-medium">{fmtHours(num(row.original.activeHours))}</span>,
      },
      {
        id: "overtimeHours",
        accessorFn: (r) => num(r.overtimeHours),
        header: "Overtime",
        meta: { label: "Overtime hours", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <HoursCell value={row.original.overtimeHours} tone="info" />,
      },
      {
        id: "taskCompletionPercent",
        accessorFn: (r) => num(r.taskCompletionPercent),
        header: "Task completion",
        meta: { label: "Task completion" },
        cell: ({ row }) => {
          const r = row.original;
          const total = num(r.tasksTotal);
          if (total === 0) return <span className="text-xs text-muted-foreground">No tasks</span>;
          return (
            <div className="flex min-w-[140px] items-center gap-2">
              <PercentBar className="flex-1" value={r.taskCompletionPercent} label={`${r.label} task completion`} />
              <span className="whitespace-nowrap text-[11px] tabular text-muted-foreground">
                {num(r.tasksCompleted)}/{total}
              </span>
            </div>
          );
        },
      },
    ],
    [groupBy, to],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      fetching={fetching}
      error={error}
      onRetry={onRetry}
      getRowId={(r) => r.key || r.label}
      maxHeight="32rem"
      empty={{
        icon: BarChart3,
        title: "No activity in this period",
        description: `Nothing was tracked between ${fmtDay(from, "MMM d")} and ${fmtDay(to, "MMM d, yyyy")} for this selection.`,
      }}
    />
  );
}
