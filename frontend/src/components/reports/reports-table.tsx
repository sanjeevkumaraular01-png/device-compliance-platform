"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertCircle, Download, FileBarChart, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { reportStatusMeta } from "@/lib/status";
import type { Paginated, Report } from "@/types/api";
import { REPORT_FORMAT_META, REPORT_TYPE_META } from "@/components/reports/report-meta";

const ACTIVE_POLL_MS = 3000;

/** Poll while any visible report is still being generated. */
function pollWhileActive(page: Paginated<unknown> | undefined): number | false {
  const rows = (page?.data ?? []) as Partial<Report>[];
  return rows.some((r) => r.status === "QUEUED" || r.status === "RUNNING") ? ACTIVE_POLL_MS : false;
}

function StatusCell({ report }: { report: Report }) {
  const m = reportStatusMeta[report.status];
  if (report.status === "RUNNING") {
    return (
      <Badge tone={m.tone}>
        <Loader2 className="animate-spin" /> {m.label}
      </Badge>
    );
  }
  if (report.status === "FAILED") {
    return (
      <SimpleTooltip label={report.error || "Report generation failed"}>
        <Badge tone={m.tone} tabIndex={0} className="cursor-help">
          <AlertCircle /> {m.label}
        </Badge>
      </SimpleTooltip>
    );
  }
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

function DownloadButton({ report }: { report: Report }) {
  const [busy, setBusy] = React.useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      await downloadFile(`/reports/${report.id}/download`, `${report.name}${REPORT_FORMAT_META[report.format]?.ext ?? ""}`);
    } catch (e) {
      toast.error("Download failed", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="xs" onClick={onClick} loading={busy} aria-label={`Download ${report.name}`}>
      {!busy && <Download />} Download
    </Button>
  );
}

export function ReportsTable({ onGenerate }: { onGenerate?: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const canCreate = can("reports:create");

  const list = useListQuery<Report>("reports", "/reports", {
    initial: { sortBy: "createdAt", sortOrder: "desc" },
    refetchInterval: pollWhileActive,
  });

  const { mutate: removeReport } = useApiMutation((r: Report) => api.delete(`/reports/${r.id}`), {
    success: (_d, r) => `Report "${r.name}" deleted`,
    invalidate: [["reports"]],
  });

  const onDelete = React.useCallback(
    async (r: Report) => {
      if (
        await confirm({
          title: "Delete report?",
          description: (
            <>
              <span className="font-medium text-foreground">{r.name}</span> and its generated file will be permanently removed.
            </>
          ),
          confirmLabel: "Delete",
          destructive: true,
        })
      ) {
        removeReport(r);
      }
    },
    [confirm, removeReport],
  );

  const columns = React.useMemo<ColumnDef<Report, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name", className: "max-w-[18rem]" },
        cell: ({ row }) => {
          const t = REPORT_TYPE_META[row.original.type];
          const Icon = t?.icon ?? FileBarChart;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium" title={row.original.name}>
                {row.original.name}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "type",
        header: "Type",
        meta: { label: "Type" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{REPORT_TYPE_META[row.original.type]?.label ?? row.original.type}</span>,
      },
      {
        accessorKey: "format",
        header: "Format",
        meta: { label: "Format" },
        cell: ({ row }) => <Badge variant="outline" className="font-mono">{REPORT_FORMAT_META[row.original.format]?.short ?? row.original.format}</Badge>,
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <StatusCell report={row.original} />,
      },
      {
        accessorKey: "rowCount",
        header: "Rows",
        enableSorting: false,
        meta: { label: "Rows", className: "text-right tabular-nums", headerClassName: "text-right" },
        cell: ({ row }) => (row.original.rowCount === null ? <span className="text-muted-foreground">—</span> : formatNumber(row.original.rowCount)),
      },
      {
        accessorKey: "fileSize",
        header: "Size",
        enableSorting: false,
        meta: { label: "File size", className: "whitespace-nowrap text-right tabular-nums", headerClassName: "text-right" },
        cell: ({ row }) => formatBytes(row.original.fileSize),
      },
      {
        id: "requestedBy",
        header: "Requested by",
        enableSorting: false,
        meta: { label: "Requested by" },
        cell: ({ row }) =>
          row.original.requestedBy ? (
            <span className="block max-w-[12rem] truncate text-xs" title={row.original.requestedBy.email}>
              {row.original.requestedBy.displayName}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{row.original.requestedById ? "—" : "Scheduler"}</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        meta: { label: "Created", className: "text-xs" },
        cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
      },
      {
        accessorKey: "completedAt",
        header: "Completed",
        meta: { label: "Completed", className: "whitespace-nowrap text-xs text-muted-foreground" },
        cell: ({ row }) => (row.original.completedAt ? formatDateTime(row.original.completedAt) : "—"),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px whitespace-nowrap text-right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {row.original.status === "COMPLETED" && <DownloadButton report={row.original} />}
            {canCreate && (
              <SimpleTooltip label="Delete report">
                <Button variant="ghost" size="icon-xs" aria-label={`Delete ${row.original.name}`} onClick={() => onDelete(row.original)}>
                  <Trash2 />
                </Button>
              </SimpleTooltip>
            )}
          </div>
        ),
      },
    ],
    [canCreate, onDelete],
  );

  return (
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
      sortBy={list.state.sortBy}
      sortOrder={list.state.sortOrder}
      onSortChange={list.setSort}
      getRowId={(r) => r.id}
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search reports…" }}
      empty={{
        icon: FileBarChart,
        title: "No reports yet",
        description: "Generate a compliance, inventory or security report to share with stakeholders.",
        action:
          canCreate && onGenerate ? (
            <Button size="sm" onClick={onGenerate}>
              Generate report
            </Button>
          ) : undefined,
      }}
    />
  );
}
