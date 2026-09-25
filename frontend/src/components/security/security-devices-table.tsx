"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { OsIcon } from "@/components/common/os-icon";
import { BoolBadge, StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { Badge } from "@/components/ui/badge";
import type { UseListQueryResult } from "@/hooks/use-list-query";
import { formatDuration } from "@/lib/format";
import { protectionMeta } from "@/lib/status";
import { PROTECTION_STATES, type ProtectionState, type SecurityDeviceRow } from "@/types/api";

const stateOptions = enumOptions(PROTECTION_STATES, (s) => protectionMeta[s].label);

function StateCell({ state, detail }: { state: ProtectionState; detail?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <StatusBadge value={state} meta={protectionMeta} />
      {detail && (
        <span className="max-w-[160px] truncate text-[11px] text-muted-foreground" title={detail}>
          {detail}
        </span>
      )}
    </div>
  );
}

export function SecurityDevicesTable({ list }: { list: UseListQueryResult<SecurityDeviceRow> }) {
  const columns = React.useMemo<ColumnDef<SecurityDeviceRow, unknown>[]>(
    () => [
      {
        id: "deviceName",
        header: "Device",
        enableHiding: false,
        enableSorting: false,
        meta: { label: "Device" },
        cell: ({ row }) => {
          const d = row.original.device;
          return (
            <Link
              href={`/devices/${d?.id ?? row.original.deviceId}`}
              className="flex min-w-0 items-center gap-2 font-medium hover:text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <OsIcon platform={d?.platform} />
              <span className="max-w-[200px] truncate">{d?.deviceName ?? row.original.deviceId}</span>
            </Link>
          );
        },
      },
      {
        id: "assignedUser",
        header: "Assigned user",
        enableSorting: false,
        meta: { label: "Assigned user" },
        cell: ({ row }) => {
          const u = row.original.device?.assignedUser;
          return u ? (
            <div className="min-w-0">
              <div className="max-w-[180px] truncate">{u.displayName}</div>
              <div className="max-w-[180px] truncate text-[11px] text-muted-foreground">{u.email}</div>
            </div>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          );
        },
      },
      {
        id: "antivirusState",
        header: "Antivirus",
        enableSorting: false,
        meta: { label: "Antivirus" },
        cell: ({ row }) => <StateCell state={row.original.antivirusState} detail={row.original.antivirusProduct} />,
      },
      {
        id: "edrState",
        header: "EDR",
        enableSorting: false,
        meta: { label: "EDR" },
        cell: ({ row }) => <StateCell state={row.original.edrState} detail={row.original.edrProduct} />,
      },
      {
        id: "firewallState",
        header: "Firewall",
        enableSorting: false,
        meta: { label: "Firewall" },
        cell: ({ row }) => <StateCell state={row.original.firewallState} />,
      },
      {
        id: "diskEncryptionState",
        header: "Encryption",
        enableSorting: false,
        meta: { label: "Encryption" },
        cell: ({ row }) => <StateCell state={row.original.diskEncryptionState} detail={row.original.encryptionMethod} />,
      },
      {
        id: "secureBootState",
        header: "Secure Boot",
        enableSorting: false,
        meta: { label: "Secure Boot" },
        cell: ({ row }) => <StateCell state={row.original.secureBootState} />,
      },
      {
        id: "screenLock",
        header: "Screen lock",
        enableSorting: false,
        meta: { label: "Screen lock" },
        cell: ({ row }) => {
          const r = row.original;
          if (r.screenLockEnabled === null || r.screenLockEnabled === undefined) return <Badge tone="unknown">Unknown</Badge>;
          return (
            <div className="flex flex-col items-start gap-0.5">
              <BoolBadge value={r.screenLockEnabled} trueLabel="Enabled" falseLabel="Disabled" />
              {r.screenLockEnabled && r.screenLockTimeoutSec ? (
                <span className="text-[11px] text-muted-foreground">after {formatDuration(r.screenLockTimeoutSec)}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "autoUpdateEnabled",
        header: "Auto-update",
        enableSorting: false,
        meta: { label: "Auto-update" },
        cell: ({ row }) => <BoolBadge value={row.original.autoUpdateEnabled} trueLabel="On" falseLabel="Off" />,
      },
      {
        id: "collectedAt",
        accessorKey: "collectedAt",
        header: "Reported",
        meta: { label: "Reported" },
        cell: ({ row }) => <RelativeTime value={row.original.collectedAt} className="text-xs text-muted-foreground" />,
      },
    ],
    [],
  );

  const f = list.state.filters;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

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
      getRowId={(r) => r.deviceId ?? r.id}
      search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search devices…" }}
      filters={
        <>
          <FilterSelect label="Antivirus" value={str(f.antivirusState)} onChange={(v) => list.setFilter("antivirusState", v)} options={stateOptions} />
          <FilterSelect label="EDR" value={str(f.edrState)} onChange={(v) => list.setFilter("edrState", v)} options={stateOptions} />
          <FilterSelect label="Firewall" value={str(f.firewallState)} onChange={(v) => list.setFilter("firewallState", v)} options={stateOptions} />
          <FilterSelect
            label="Encryption"
            value={str(f.diskEncryptionState)}
            onChange={(v) => list.setFilter("diskEncryptionState", v)}
            options={stateOptions}
          />
          <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
        </>
      }
      empty={{
        icon: ShieldCheck,
        title: list.activeFilterCount || list.state.search ? "No devices match these filters" : "No security data yet",
        description:
          list.activeFilterCount || list.state.search
            ? "Try changing or clearing the filters."
            : "Security status appears once enrolled agents submit their first report.",
      }}
    />
  );
}
