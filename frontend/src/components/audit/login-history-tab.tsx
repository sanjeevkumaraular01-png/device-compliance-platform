"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, DateRangeFilter, FilterSelect } from "@/components/data-table/filters";
import { Badge } from "@/components/ui/badge";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { formatDateTimeSeconds, formatRelative } from "@/lib/format";
import type { LoginHistory } from "@/types/api";
import { authProviderLabel } from "@/components/audit/audit-meta";
import { UserPicker } from "@/components/users/user-picker";
import { dateInputToIso, isoToDateInput } from "@/components/audit/dates";

export function LoginHistoryTab() {
  const list = useListQuery<LoginHistory>("audit", "/audit/login-history", { initial: { sortBy: "occurredAt", sortOrder: "desc", pageSize: 50 } });
  const [userLabel, setUserLabel] = React.useState<string | null>(null);
  const f = list.state.filters;

  const columns = React.useMemo<ColumnDef<LoginHistory, unknown>[]>(
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
        accessorKey: "email",
        header: "Email",
        meta: { label: "Email" },
        cell: ({ row }) => <span className="block max-w-[16rem] truncate" title={row.original.email}>{row.original.email}</span>,
      },
      {
        accessorKey: "provider",
        header: "Provider",
        enableSorting: false,
        meta: { label: "Provider" },
        cell: ({ row }) => <Badge variant="outline">{authProviderLabel[row.original.provider] ?? row.original.provider}</Badge>,
      },
      {
        accessorKey: "success",
        header: "Result",
        meta: { label: "Result" },
        cell: ({ row }) =>
          row.original.success ? (
            <Badge tone="success" dot>
              Success
            </Badge>
          ) : (
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <Badge tone="critical" dot>
                Failed
              </Badge>
              {row.original.reason && (
                <span className="max-w-[14rem] truncate text-[11px] text-muted-foreground" title={row.original.reason}>
                  {row.original.reason}
                </span>
              )}
            </div>
          ),
      },
      {
        accessorKey: "mfaUsed",
        header: "MFA",
        enableSorting: false,
        meta: { label: "MFA used" },
        cell: ({ row }) =>
          row.original.mfaUsed ? (
            <Badge tone="info">
              <ShieldCheck /> MFA
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">No</span>
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
        accessorKey: "userAgent",
        header: "User agent",
        enableSorting: false,
        meta: { label: "User agent" },
        cell: ({ row }) =>
          row.original.userAgent ? (
            <SimpleTooltip label={<span className="break-all">{row.original.userAgent}</span>}>
              <span tabIndex={0} className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                {row.original.userAgent}
              </span>
            </SimpleTooltip>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
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
      getRowId={(r) => String(r.id)}
      rowClassName={(r) => (r.success ? undefined : "bg-sev-critical/[0.03]")}
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search email or IP…" }}
      filters={
        <>
          <FilterSelect
            label="Result"
            value={f.success === undefined ? undefined : String(f.success)}
            onChange={(v) => list.setFilter("success", v === undefined ? undefined : v === "true")}
            options={[
              { value: "true", label: "Success" },
              { value: "false", label: "Failed" },
            ]}
          />
          <UserPicker
            size="sm"
            value={f.userId as string | undefined}
            selectedLabel={userLabel}
            onChange={(id, u) => {
              setUserLabel(u?.displayName ?? null);
              list.setFilter("userId", id);
            }}
            placeholder="User: Anyone"
            aria-label="Filter by user"
            className="w-full sm:w-48"
          />
          <DateRangeFilter
            from={isoToDateInput(f.from)}
            to={isoToDateInput(f.to)}
            onChange={({ from, to }) => {
              list.setFilter("from", dateInputToIso(from));
              list.setFilter("to", dateInputToIso(to, true));
            }}
          />
          <ClearFiltersButton
            count={list.activeFilterCount}
            onClear={() => {
              setUserLabel(null);
              list.clearFilters();
            }}
          />
        </>
      }
      empty={{
        icon: list.activeFilterCount ? KeyRound : LogIn,
        title: "No sign-in events",
        description: list.activeFilterCount ? "No sign-ins match the current filters." : "Console sign-in attempts will be recorded here.",
      }}
    />
  );
}
