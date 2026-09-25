"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { CalendarRange, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { attendanceMeta, toneBadge } from "@/lib/status";
import { cn } from "@/lib/utils";
import { DateInput, DepartmentFilter, PersonCell, currentMonth, fmtHours, fmtMinutes } from "@/components/workforce/common";
import { ATTENDANCE_STATUSES, type MonthlyAttendance, type MonthlyAttendanceDay, type MonthlyAttendanceTotals } from "@/types/api";

type ExportFormat = "csv" | "xlsx";

function parseDay(d: string) {
  const p = parseISO(d.length === 10 ? `${d}T00:00:00` : d);
  return isValid(p) ? p : null;
}

function isWeekend(d: string): boolean {
  const p = parseDay(d);
  if (!p) return false;
  const w = p.getDay();
  return w === 0 || w === 6;
}

const TOTAL_COLUMNS: { key: keyof MonthlyAttendanceTotals; label: string; hours?: boolean }[] = [
  { key: "present", label: "Present" },
  { key: "late", label: "Late" },
  { key: "halfDay", label: "Half-day" },
  { key: "absent", label: "Absent" },
  { key: "leave", label: "Leave" },
  { key: "workedHours", label: "Worked h", hours: true },
  { key: "overtimeHours", label: "Overtime h", hours: true },
  { key: "missingHours", label: "Missing h", hours: true },
];

export function AttendanceMonthlyTab() {
  const [month, setMonth] = React.useState(() => currentMonth());
  const [departmentId, setDepartmentId] = React.useState<string | undefined>();
  const [exporting, setExporting] = React.useState<ExportFormat | null>(null);

  const params = React.useMemo(() => ({ month, departmentId }), [month, departmentId]);
  const query = useQuery({
    queryKey: ["workforce", "attendance", "monthly", params],
    queryFn: () => api.get<MonthlyAttendance>("/workforce/attendance/monthly", params),
    placeholderData: keepPreviousData,
  });

  const days = React.useMemo(() => query.data?.days ?? [], [query.data]);
  const rows = React.useMemo(() => query.data?.rows ?? [], [query.data]);

  const onExport = async (fmt: ExportFormat) => {
    setExporting(fmt);
    try {
      await downloadFile("/workforce/attendance/export", `attendance-${month}.${fmt}`, { month, format: fmt, departmentId });
    } catch (e) {
      toast.error("Export failed", { description: errorMessage(e) });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b p-2.5">
        <DateInput type="month" label="Month" value={month} onChange={setMonth} max={currentMonth()} />
        <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
        {query.isFetching && !query.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onExport("csv")} loading={exporting === "csv"} disabled={!!exporting}>
            <FileText /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExport("xlsx")} loading={exporting === "xlsx"} disabled={!!exporting}>
            <FileSpreadsheet /> XLSX
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : query.error && !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} compact />
      ) : rows.length === 0 || days.length === 0 ? (
        <EmptyState
          compact
          icon={CalendarRange}
          title="No attendance for this month"
          description="Pick another month or department. Days appear once employees have work sessions."
          className="py-10"
        />
      ) : (
        <MonthlyGrid days={days} rows={rows} fetching={query.isFetching} />
      )}

      <Legend />
    </div>
  );
}

function MonthlyGrid({ days, rows, fetching }: { days: string[]; rows: MonthlyAttendance["rows"]; fetching: boolean }) {
  const weekend = React.useMemo(() => days.map(isWeekend), [days]);
  return (
    <div
      className={cn("relative w-full overflow-auto scrollbar-thin", fetching && "opacity-80 transition-opacity")}
      style={{ maxHeight: "max(24rem, calc(100dvh - 18rem))" }}
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">Monthly attendance sheet: employees by day, followed by monthly totals</caption>
        <thead className="sticky top-0 z-20">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-30 min-w-[180px] border-b border-r bg-muted px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Employee
            </th>
            {days.map((d, i) => {
              const p = parseDay(d);
              return (
                <th
                  key={d}
                  scope="col"
                  className={cn("min-w-[38px] border-b px-0.5 py-1 text-center font-medium", weekend[i] ? "bg-accent text-muted-foreground" : "bg-muted")}
                  title={p ? format(p, "EEEE, MMM d") : d}
                >
                  <div className="text-[11px] tabular text-foreground">{p ? format(p, "d") : d.slice(-2)}</div>
                  <div className="text-[9px] uppercase text-muted-foreground">{p ? format(p, "EEEEE") : ""}</div>
                </th>
              );
            })}
            {TOTAL_COLUMNS.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap border-b bg-muted px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                  i === 0 && "border-l",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const byDate = new Map<string, MonthlyAttendanceDay>();
            for (const d of r.days ?? []) if (d?.date) byDate.set(d.date.slice(0, 10), d);
            const name = r.user?.displayName ?? "Unknown employee";
            return (
              <tr key={r.user?.id ?? idx} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 text-left font-normal group-hover:bg-accent"
                >
                  <PersonCell
                    className="max-w-[220px]"
                    name={name}
                    sub={r.user?.department?.name ?? r.user?.jobTitle ?? undefined}
                    href={r.user?.id ? `/workforce/people/${r.user.id}` : undefined}
                  />
                </th>
                {days.map((d, i) => (
                  <DayCell key={d} name={name} date={d} day={byDate.get(d.slice(0, 10))} weekend={weekend[i]} />
                ))}
                {TOTAL_COLUMNS.map((c, i) => {
                  const v = r.totals?.[c.key];
                  return (
                    <td key={c.key} className={cn("whitespace-nowrap border-b px-2 py-1.5 text-right tabular group-hover:bg-accent/40", i === 0 && "border-l")}>
                      {v === undefined || v === null ? "—" : c.hours ? fmtHours(v).replace(" h", "") : v}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DayCell({ name, date, day, weekend }: { name: string; date: string; day: MonthlyAttendanceDay | undefined; weekend: boolean }) {
  const p = parseDay(date);
  const dateLabel = p ? format(p, "EEE, MMM d") : date;
  const status = day?.status ?? null;
  const meta = status ? attendanceMeta[status] : null;
  const worked = day?.workedMinutes ?? 0;
  const late = day?.lateMinutes ?? 0;
  const label = meta
    ? `${name}, ${dateLabel}: ${meta.label}${worked > 0 ? `, worked ${fmtMinutes(worked)}` : ""}${late > 0 ? `, late ${fmtMinutes(late)}` : ""}`
    : `${name}, ${dateLabel}: no record`;
  return (
    <td className={cn("border-b px-0.5 py-1 text-center align-middle", weekend ? "bg-accent/60" : "group-hover:bg-accent/40")} title={label}>
      {meta ? (
        <div className="flex flex-col items-center gap-0.5" role="img" aria-label={label}>
          <span className={cn("inline-grid h-5 min-w-6 place-items-center rounded px-1 text-[10px] font-semibold ring-1 ring-inset", toneBadge[meta.tone])}>
            {meta.short}
          </span>
          {worked > 0 && <span className="text-[9px] leading-none tabular text-muted-foreground">{(Math.round((worked / 60) * 10) / 10).toString()}</span>}
        </div>
      ) : (
        <span className="text-muted-foreground/60" aria-label={label}>
          ·
        </span>
      )}
    </td>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
      {ATTENDANCE_STATUSES.map((s) => {
        const m = attendanceMeta[s];
        return (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-grid h-4 min-w-5 place-items-center rounded px-1 text-[9px] font-semibold ring-1 ring-inset", toneBadge[m.tone])}>{m.short}</span>
            {m.label}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-4 rounded-sm bg-accent" aria-hidden /> Weekend
      </span>
      <span>Number under a letter = hours worked</span>
    </div>
  );
}
