"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { DateInput, DepartmentFilter, fmtMinutes, Metric, PersonCell, shiftDate, todayLocal } from "@/components/workforce/common";
import { ReportDetailSheet, reportMinutes } from "@/components/workforce/reports/report-detail-sheet";
import { ReportStatusBadge } from "@/components/workforce/reports/report-view";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { dailyReportStatusMeta } from "@/lib/status";
import { DAILY_REPORT_STATUSES, type Paginated, type TeamReportRow } from "@/types/api";

const isMissing = (r: TeamReportRow) => r.missing === true || r.status === "MISSING" || r.id === null;
const rowKey = (r: TeamReportRow) => r.id ?? `missing:${r.user?.id ?? "?"}:${r.date}`;

function itemCount(r: TeamReportRow): number | null {
  if (Array.isArray(r.items)) return r.items.length;
  const c = (r as { _count?: { items?: number }; itemsCount?: number }).itemsCount ?? (r as { _count?: { items?: number } })._count?.items;
  return typeof c === "number" ? c : null;
}

export function TeamReportsTab() {
  const today = todayLocal();
  const [date, setDate] = React.useState(today);
  const [departmentId, setDepartmentId] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>();
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  const params = { date, departmentId, status };
  // `GET /daily-reports` returns an array or a {data, meta} page; missing pseudo-rows make server
  // paging awkward, so we request one large page and paginate on the client.
  const q = useQuery({
    queryKey: ["daily-reports", "team", params],
    queryFn: async () => normalizeList(await api.get<Paginated<TeamReportRow> | TeamReportRow[]>("/daily-reports", { ...params, pageSize: 200 })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const rows = React.useMemo(() => (q.data ?? []).filter((r) => r && r.user), [q.data]);
  const counts = React.useMemo(() => {
    const c = { total: rows.length, submitted: 0, approved: 0, changes: 0, draft: 0, missing: 0 };
    for (const r of rows) {
      if (isMissing(r)) c.missing++;
      else if (r.status === "SUBMITTED") c.submitted++;
      else if (r.status === "APPROVED") c.approved++;
      else if (r.status === "CHANGES_REQUESTED") c.changes++;
      else if (r.status === "DRAFT") c.draft++;
    }
    return c;
  }, [rows]);
  const open = openKey ? (rows.find((r) => rowKey(r) === openKey) ?? null) : null;

  const columns = React.useMemo<ColumnDef<TeamReportRow, unknown>[]>(
    () => [
      {
        id: "employee",
        header: "Employee",
        accessorFn: (r) => r.user?.displayName ?? "",
        meta: { label: "Employee" },
        cell: ({ row }) => (
          <PersonCell
            name={row.original.user.displayName}
            sub={[row.original.user.jobTitle, row.original.user.department?.name].filter(Boolean).join(" · ") || row.original.user.email}
            href={`/workforce/people/${row.original.user.id}?date=${date}`}
            className="max-w-[240px]"
          />
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => (isMissing(r) ? "MISSING" : r.status),
        meta: { label: "Status" },
        cell: ({ row }) => <ReportStatusBadge value={isMissing(row.original) ? "MISSING" : row.original.status} />,
      },
      {
        id: "items",
        header: "Items",
        accessorFn: (r) => itemCount(r) ?? -1,
        meta: { label: "Items", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => {
          const n = itemCount(row.original);
          return isMissing(row.original) || n === null ? <span className="text-muted-foreground">—</span> : n;
        },
      },
      {
        id: "minutes",
        header: "Reported time",
        accessorFn: (r) => reportMinutes(r) ?? -1,
        meta: { label: "Reported time", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => {
          const m = reportMinutes(row.original);
          return m === null ? <span className="text-muted-foreground">—</span> : <span className="whitespace-nowrap">{fmtMinutes(m)}</span>;
        },
      },
      {
        id: "submittedAt",
        header: "Submitted",
        accessorFn: (r) => r.submittedAt ?? "",
        meta: { label: "Submitted at" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.submittedAt ? formatDateTime(row.original.submittedAt) : "—"}</span>,
      },
      {
        id: "reviewer",
        header: "Reviewer",
        accessorFn: (r) => r.reviewer?.displayName ?? "",
        meta: { label: "Reviewer" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.reviewer?.displayName ?? "—"}</span>,
      },
    ],
    [date],
  );

  return (
    <div className="grid grid-cols-1 min-w-0 gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Submitted" value={counts.submitted} sub="awaiting review" tone={counts.submitted > 0 ? "info" : undefined} />
        <Metric label="Approved" value={counts.approved} tone={counts.approved > 0 ? "success" : undefined} />
        <Metric label="Changes requested" value={counts.changes} sub={counts.draft ? `${counts.draft} draft` : undefined} tone={counts.changes > 0 ? "medium" : undefined} />
        <Metric label="Missing" value={counts.missing} sub={counts.total ? `of ${counts.total} employees` : undefined} tone={counts.missing > 0 ? "critical" : "success"} />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        getRowId={rowKey}
        onRowClick={(r) => !isMissing(r) && setOpenKey(rowKey(r))}
        rowClassName={(r) => (isMissing(r) ? "bg-sev-critical/5 cursor-default" : undefined)}
        columnToggle={false}
        filters={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
                <ChevronLeft />
              </Button>
              <DateInput value={date} onChange={(d) => setDate(d > today ? today : d)} max={today} label="Report date" />
              <Button variant="outline" size="icon-sm" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} aria-label="Next day">
                <ChevronRight />
              </Button>
            </div>
            <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[...DAILY_REPORT_STATUSES, "MISSING" as const].map((s) => ({ value: s, label: dailyReportStatusMeta[s].label }))}
            />
          </>
        }
        empty={{
          icon: ClipboardList,
          title: "No reports for this day",
          description: status || departmentId ? "Try clearing the filters." : "Nobody in your scope was expected to report on this day (non-working day or no employees).",
        }}
      />
      <ReportDetailSheet row={open} onOpenChange={(o) => !o && setOpenKey(null)} />
    </div>
  );
}
