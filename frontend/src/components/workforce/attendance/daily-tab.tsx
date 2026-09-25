"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarX2, PencilLine, UserCog } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, DateRangeFilter, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { UserPicker } from "@/components/users/user-picker";
import { useListQuery } from "@/hooks/use-list-query";
import { useAuth } from "@/lib/auth";
import { attendanceMeta, toneText, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import {
  AttendanceBadge,
  DepartmentFilter,
  LocationBadge,
  PersonCell,
  fmtDay,
  fmtHm,
  fmtMinutes,
  fmtTime,
  todayLocal,
} from "@/components/workforce/common";
import { AttendanceCorrectionDialog } from "@/components/workforce/attendance/correction-dialog";
import { ATTENDANCE_STATUSES, type AttendanceRow } from "@/types/api";

/** Minutes cell: muted dash at 0, tone-colored duration when > 0. */
export function MinutesCell({ value, tone }: { value: number | null | undefined; tone: Tone }) {
  const v = value ?? 0;
  if (v <= 0) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("whitespace-nowrap font-medium", toneText[tone])}>{fmtMinutes(v)}</span>;
}

const DATE_KEYS = ["from", "to"];

export function AttendanceDailyTab() {
  const { can } = useAuth();
  const canManage = can("workforce:manage");
  const today = React.useMemo(() => todayLocal(), []);
  const list = useListQuery<AttendanceRow>(["workforce", "attendance"], "/workforce/attendance", {
    initial: { filters: { from: today, to: today } },
  });
  const [editing, setEditing] = React.useState<AttendanceRow | null>(null);

  const f = list.state.filters;
  const from = f.from as string | undefined;
  const to = f.to as string | undefined;
  const nonDateFilters = Object.entries(f).filter(([k, v]) => !DATE_KEYS.includes(k) && v !== undefined && v !== "").length;
  const dateChanged = from !== today || to !== today;

  const columns = React.useMemo<ColumnDef<AttendanceRow, unknown>[]>(() => {
    const cols: ColumnDef<AttendanceRow, unknown>[] = [
      {
        id: "employee",
        header: "Employee",
        enableSorting: false,
        enableHiding: false,
        meta: { label: "Employee" },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <PersonCell
              className="min-w-[180px] max-w-[260px]"
              name={r.user?.displayName ?? "Unknown employee"}
              sub={r.user?.department?.name ?? r.user?.email}
              href={r.userId ? `/workforce/people/${r.userId}?date=${encodeURIComponent(r.date ?? "")}` : undefined}
            />
          );
        },
      },
      {
        id: "date",
        header: "Date",
        enableSorting: false,
        meta: { label: "Date" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDay(row.original.date)}</span>,
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        meta: { label: "Status" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <AttendanceBadge value={row.original.status} />
            {row.original.isManuallyAdjusted && (
              <SimpleTooltip label={row.original.adjustmentNote ? `Adjusted: ${row.original.adjustmentNote}` : "Manually adjusted"}>
                <span tabIndex={0} className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Badge tone="primary" aria-label={`Manually adjusted${row.original.adjustmentNote ? `: ${row.original.adjustmentNote}` : ""}`}>
                    <PencilLine /> Adjusted
                  </Badge>
                </span>
              </SimpleTooltip>
            )}
          </span>
        ),
      },
      {
        id: "location",
        header: "Location",
        enableSorting: false,
        meta: { label: "Location" },
        cell: ({ row }) => <LocationBadge value={row.original.location} />,
      },
      {
        id: "clockInAt",
        header: "In",
        enableSorting: false,
        meta: { label: "Clock in", className: "tabular" },
        cell: ({ row }) => fmtTime(row.original.clockInAt),
      },
      {
        id: "clockOutAt",
        header: "Out",
        enableSorting: false,
        meta: { label: "Clock out", className: "tabular" },
        cell: ({ row }) => fmtTime(row.original.clockOutAt),
      },
      {
        id: "worked",
        header: "Worked",
        enableSorting: false,
        meta: { label: "Worked", className: "text-right tabular whitespace-nowrap", headerClassName: "text-right" },
        cell: ({ row }) => <span className="font-medium">{fmtHm((row.original.activeSec ?? 0) + (row.original.meetingSec ?? 0))}</span>,
      },
      {
        id: "lateMinutes",
        header: "Late",
        enableSorting: false,
        meta: { label: "Late", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <MinutesCell value={row.original.lateMinutes} tone="medium" />,
      },
      {
        id: "earlyLeaveMinutes",
        header: "Early leave",
        enableSorting: false,
        meta: { label: "Early leave", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <MinutesCell value={row.original.earlyLeaveMinutes} tone="high" />,
      },
      {
        id: "overtimeMinutes",
        header: "Overtime",
        enableSorting: false,
        meta: { label: "Overtime", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <MinutesCell value={row.original.overtimeMinutes} tone="info" />,
      },
      {
        id: "missingMinutes",
        header: "Missing",
        enableSorting: false,
        meta: { label: "Missing", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => <MinutesCell value={row.original.missingMinutes} tone="critical" />,
      },
    ];
    if (canManage) {
      cols.push({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row.original);
            }}
            aria-label={`Correct attendance of ${row.original.user?.displayName ?? "employee"} on ${fmtDay(row.original.date)}`}
          >
            <UserCog /> Correct
          </Button>
        ),
      });
    }
    return cols;
  }, [canManage]);

  return (
    <>
      <DataTable
        columns={columns}
        data={list.rows}
        meta={list.meta}
        loading={list.query.isLoading}
        fetching={list.query.isFetching}
        error={list.query.error}
        onRetry={() => list.query.refetch()}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        getRowId={(r) => r.id}
        filters={
          <>
            <DateRangeFilter
              from={from}
              to={to}
              onChange={(r) => {
                list.setFilter("from", r.from);
                list.setFilter("to", r.to);
              }}
            />
            <DepartmentFilter value={f.departmentId as string | undefined} onChange={(v) => list.setFilter("departmentId", v)} />
            <FilterSelect
              label="Status"
              value={f.status as string | undefined}
              onChange={(v) => list.setFilter("status", v)}
              options={enumOptions(ATTENDANCE_STATUSES, (v) => attendanceMeta[v].label)}
            />
            <UserPicker
              size="sm"
              className="w-full sm:w-52"
              aria-label="Filter by employee"
              placeholder="All employees"
              value={f.userId as string | undefined}
              onChange={(id) => list.setFilter("userId", id)}
            />
            <ClearFiltersButton
              count={nonDateFilters + (dateChanged ? 1 : 0)}
              onClear={() => {
                list.clearFilters();
                list.setFilter("from", today);
                list.setFilter("to", today);
              }}
            />
          </>
        }
        empty={{
          icon: CalendarX2,
          title: "No attendance records",
          description: "No work sessions match these filters. Records appear once employees clock in or the agent reports activity.",
        }}
      />
      <AttendanceCorrectionDialog row={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}
