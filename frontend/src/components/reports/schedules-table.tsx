"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { platformLabel } from "@/lib/format";
import { complianceMeta } from "@/lib/status";
import type { Paginated, ReportSchedule } from "@/types/api";
import { REPORT_FORMAT_META, REPORT_TYPE_META, describeCron } from "@/components/reports/report-meta";

export function SchedulesTable({ onCreate }: { onCreate: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const canCreate = can("reports:create");
  const departments = useDepartments();
  const deptName = React.useCallback((id: string) => departments.data?.find((d) => d.id === id)?.name ?? "Department", [departments.data]);

  const query = useQuery({
    queryKey: ["reports", "schedules"],
    queryFn: async ({ signal }) =>
      normalizeList(await api.get<Paginated<ReportSchedule> | ReportSchedule[]>("/reports/schedules", undefined, { signal })).data,
  });

  const { mutate: removeSchedule } = useApiMutation((s: ReportSchedule) => api.delete(`/reports/schedules/${s.id}`), {
    success: (_d, s) => `Schedule "${s.name}" deleted`,
    invalidate: [["reports", "schedules"]],
  });

  const onDelete = React.useCallback(
    async (s: ReportSchedule) => {
      if (
        await confirm({
          title: "Delete schedule?",
          description: (
            <>
              <span className="font-medium text-foreground">{s.name}</span> will stop running. Reports it already generated are kept.
            </>
          ),
          confirmLabel: "Delete",
          destructive: true,
        })
      ) {
        removeSchedule(s);
      }
    },
    [confirm, removeSchedule],
  );

  const columns = React.useMemo<ColumnDef<ReportSchedule, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => {
          const Icon = REPORT_TYPE_META[row.original.type]?.icon ?? CalendarClock;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="max-w-[16rem] truncate font-medium">{row.original.name}</p>
                <p className="text-xs text-muted-foreground">{REPORT_TYPE_META[row.original.type]?.label ?? row.original.type}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "format",
        header: "Format",
        meta: { label: "Format" },
        cell: ({ row }) => <Badge variant="outline" className="font-mono">{REPORT_FORMAT_META[row.original.format]?.short ?? row.original.format}</Badge>,
      },
      {
        accessorKey: "cron",
        header: "Schedule",
        meta: { label: "Schedule" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="whitespace-nowrap text-xs">{describeCron(row.original.cron)}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{row.original.cron}</p>
          </div>
        ),
      },
      {
        id: "recipients",
        header: "Recipients",
        enableSorting: false,
        meta: { label: "Recipients" },
        cell: ({ row }) => {
          const r = row.original.recipients ?? [];
          if (!r.length) return <span className="text-muted-foreground">—</span>;
          return (
            <SimpleTooltip label={r.join(", ")}>
              <span className="block max-w-[14rem] truncate text-xs" tabIndex={0}>
                {r[0]}
                {r.length > 1 && <span className="text-muted-foreground"> +{r.length - 1}</span>}
              </span>
            </SimpleTooltip>
          );
        },
      },
      {
        id: "scope",
        header: "Scope",
        enableSorting: false,
        meta: { label: "Scope" },
        cell: ({ row }) => {
          const p = row.original.parameters ?? {};
          const parts = [
            p.departmentId ? deptName(p.departmentId) : null,
            p.platform ? platformLabel[p.platform] : null,
            p.complianceState ? complianceMeta[p.complianceState]?.label : null,
          ].filter(Boolean);
          return parts.length ? (
            <div className="flex flex-wrap gap-1">
              {parts.map((x) => (
                <Badge key={x} variant="secondary">
                  {x}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">All devices</span>
          );
        },
      },
      {
        accessorKey: "enabled",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => (
          <Badge tone={row.original.enabled ? "success" : "neutral"} dot>
            {row.original.enabled ? "Enabled" : "Disabled"}
          </Badge>
        ),
      },
      {
        accessorKey: "lastRunAt",
        header: "Last run",
        meta: { label: "Last run", className: "text-xs" },
        cell: ({ row }) => <RelativeTime value={row.original.lastRunAt} fallback="Not yet" />,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) =>
          canCreate ? (
            <SimpleTooltip label="Delete schedule">
              <Button variant="ghost" size="icon-xs" aria-label={`Delete schedule ${row.original.name}`} onClick={() => onDelete(row.original)}>
                <Trash2 />
              </Button>
            </SimpleTooltip>
          ) : null,
      },
    ],
    [canCreate, deptName, onDelete],
  );

  return (
    <DataTable
      columns={columns}
      data={query.data ?? []}
      loading={query.isLoading}
      fetching={query.isFetching}
      error={query.error}
      onRetry={() => query.refetch()}
      getRowId={(s) => s.id}
      actions={
        canCreate ? (
          <Button size="sm" onClick={onCreate}>
            <Plus /> New schedule
          </Button>
        ) : undefined
      }
      empty={{
        icon: CalendarClock,
        title: "No scheduled reports",
        description: "Schedule recurring reports to email compliance and security summaries automatically.",
        action: canCreate ? (
          <Button size="sm" variant="outline" onClick={onCreate}>
            <Plus /> New schedule
          </Button>
        ) : undefined,
      }}
    />
  );
}
