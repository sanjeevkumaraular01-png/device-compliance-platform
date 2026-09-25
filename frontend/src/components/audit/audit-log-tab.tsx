"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, DateRangeFilter, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { useDebounce } from "@/hooks/use-debounce";
import { downloadFile, errorMessage } from "@/lib/api";
import { formatDateTimeSeconds, formatRelative } from "@/lib/format";
import { AUDIT_CATEGORIES, type AuditLog } from "@/types/api";
import { ActorLabel, AuditCategoryBadge, SuccessBadge, auditCategoryMeta } from "@/components/audit/audit-meta";
import { AuditDetailSheet } from "@/components/audit/audit-detail-sheet";
import { VerifyIntegrityButton } from "@/components/audit/verify-integrity";
import { UserPicker } from "@/components/users/user-picker";
import { dateInputToIso, isoToDateInput } from "@/components/audit/dates";

function shortId(id: string | null | undefined, n = 8) {
  if (!id) return null;
  return id.length > n + 1 ? `${id.slice(0, n)}…` : id;
}

export function AuditLogTab() {
  const list = useListQuery<AuditLog>("audit", "/audit", { initial: { sortBy: "occurredAt", sortOrder: "desc", pageSize: 50 } });
  const { setFilter } = list;
  const [selected, setSelected] = React.useState<AuditLog | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // Free-text action filter (debounced so we don't query on every keystroke).
  const [action, setAction] = React.useState("");
  const debouncedAction = useDebounce(action, 350);
  React.useEffect(() => {
    setFilter("action", debouncedAction.trim() || undefined);
  }, [debouncedAction, setFilter]);

  const [actorLabel, setActorLabel] = React.useState<string | null>(null);
  const f = list.state.filters;

  const clearAll = () => {
    setAction("");
    setActorLabel(null);
    list.clearFilters();
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const { page: _p, pageSize: _ps, sortBy: _sb, sortOrder: _so, ...filters } = list.params;
      await downloadFile("/audit/export", "audit-log.csv", { format: "csv", ...filters });
      toast.success("Audit log export downloaded");
    } catch (e) {
      toast.error("Export failed", { description: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  const columns = React.useMemo<ColumnDef<AuditLog, unknown>[]>(
    () => [
      {
        accessorKey: "occurredAt",
        header: "Time",
        meta: { label: "Time", className: "whitespace-nowrap" },
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums" title={formatRelative(row.original.occurredAt)}>
            {formatDateTimeSeconds(row.original.occurredAt)}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        meta: { label: "Category" },
        cell: ({ row }) => <AuditCategoryBadge value={row.original.category} />,
      },
      {
        accessorKey: "action",
        header: "Action",
        meta: { label: "Action" },
        cell: ({ row }) => <span className="block max-w-[16rem] truncate font-mono text-xs" title={row.original.action}>{row.original.action}</span>,
      },
      {
        id: "actor",
        header: "Actor",
        enableSorting: false,
        meta: { label: "Actor" },
        cell: ({ row }) => (
          <span className="block max-w-[12rem] text-xs">
            <ActorLabel type={row.original.actorType} name={row.original.actorName} id={row.original.actorId} />
          </span>
        ),
      },
      {
        id: "resource",
        header: "Resource",
        enableSorting: false,
        meta: { label: "Resource" },
        cell: ({ row }) =>
          row.original.resourceType || row.original.resourceId ? (
            <div className="min-w-0 text-xs">
              <p className="truncate">{row.original.resourceType ?? "—"}</p>
              {row.original.resourceId && (
                <p className="font-mono text-[11px] text-muted-foreground" title={row.original.resourceId}>
                  {shortId(row.original.resourceId)}
                </p>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "device",
        header: "Device",
        enableSorting: false,
        meta: { label: "Device" },
        cell: ({ row }) =>
          row.original.deviceId ? (
            <Link
              href={`/devices/${row.original.deviceId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs text-primary hover:underline"
              title={row.original.deviceId}
            >
              {shortId(row.original.deviceId)}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "ipAddress",
        header: "IP",
        enableSorting: false,
        meta: { label: "IP address", className: "whitespace-nowrap font-mono text-xs" },
        cell: ({ row }) => row.original.ipAddress ?? <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "success",
        header: "Result",
        enableSorting: false,
        meta: { label: "Result" },
        cell: ({ row }) => <SuccessBadge success={row.original.success} />,
      },
    ],
    [],
  );

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
        sortBy={list.state.sortBy}
        sortOrder={list.state.sortOrder}
        onSortChange={list.setSort}
        getRowId={(r) => String(r.id)}
        onRowClick={(r) => {
          setSelected(r);
          setSheetOpen(true);
        }}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search audit log…" }}
        filters={
          <>
            <FilterSelect
              label="Category"
              value={f.category as string | undefined}
              onChange={(v) => list.setFilter("category", v)}
              options={enumOptions(AUDIT_CATEGORIES, (c) => auditCategoryMeta[c].label)}
            />
            <Input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Action, e.g. device.update"
              aria-label="Filter by action"
              className="h-8 w-full font-mono text-xs sm:w-48"
            />
            <UserPicker
              size="sm"
              value={f.actorId as string | undefined}
              selectedLabel={actorLabel}
              onChange={(id, u) => {
                setActorLabel(u?.displayName ?? null);
                list.setFilter("actorId", id);
              }}
              placeholder="Actor: Anyone"
              aria-label="Filter by actor"
              className="w-full sm:w-48"
            />
            <FilterSelect
              label="Result"
              value={f.success === undefined ? undefined : String(f.success)}
              onChange={(v) => list.setFilter("success", v === undefined ? undefined : v === "true")}
              options={[
                { value: "true", label: "Success" },
                { value: "false", label: "Failed" },
              ]}
            />
            <DateRangeFilter
              from={isoToDateInput(f.from)}
              to={isoToDateInput(f.to)}
              onChange={({ from, to }) => {
                list.setFilter("from", dateInputToIso(from));
                list.setFilter("to", dateInputToIso(to, true));
              }}
            />
            <ClearFiltersButton count={list.activeFilterCount} onClear={clearAll} />
          </>
        }
        actions={
          <>
            <VerifyIntegrityButton />
            <SimpleTooltip label="Export the entries matching the current filters">
              <Button variant="outline" size="sm" onClick={onExport} loading={exporting}>
                {!exporting && <Download />} Export CSV
              </Button>
            </SimpleTooltip>
          </>
        }
        empty={{
          icon: ScrollText,
          title: "No audit entries",
          description: list.activeFilterCount ? "No entries match the current filters." : "Administrative actions will appear here as they happen.",
        }}
      />
      <AuditDetailSheet entry={selected} open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}

