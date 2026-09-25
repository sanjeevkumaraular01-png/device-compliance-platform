"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Usb } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { useListQuery } from "@/hooks/use-list-query";
import { formatBytes, formatDateTimeSeconds, humanize } from "@/lib/format";
import { usbEventMeta } from "@/lib/status";
import type { UsbEvent } from "@/types/api";

const dash = <span className="text-muted-foreground">—</span>;

const columns: ColumnDef<UsbEvent, unknown>[] = [
  {
    id: "eventType",
    accessorKey: "eventType",
    header: "Event",
    enableHiding: false,
    meta: { label: "Event" },
    cell: ({ row }) => <StatusBadge value={row.original.eventType} meta={usbEventMeta} />,
  },
  {
    id: "deviceClass",
    accessorKey: "deviceClass",
    header: "Class",
    meta: { label: "Device class" },
    cell: ({ row }) => <span className="whitespace-nowrap text-xs">{humanize(row.original.deviceClass)}</span>,
  },
  {
    id: "vendorId",
    accessorKey: "vendorId",
    header: "VID:PID",
    meta: { label: "VID:PID" },
    cell: ({ row }) =>
      row.original.vendorId || row.original.productId ? (
        <span className="whitespace-nowrap font-mono text-xs">
          {row.original.vendorId ?? "????"}:{row.original.productId ?? "????"}
        </span>
      ) : (
        dash
      ),
  },
  {
    id: "serialNumber",
    accessorKey: "serialNumber",
    header: "Serial",
    meta: { label: "USB serial", className: "max-w-[160px]" },
    cell: ({ row }) => (row.original.serialNumber ? <span className="block truncate font-mono text-xs" title={row.original.serialNumber}>{row.original.serialNumber}</span> : dash),
  },
  {
    id: "label",
    accessorKey: "label",
    header: "Label",
    meta: { label: "Volume label" },
    cell: ({ row }) => row.original.label ?? dash,
  },
  {
    id: "userName",
    accessorKey: "userName",
    header: "User",
    meta: { label: "User" },
    cell: ({ row }) => (row.original.userName ? <span className="whitespace-nowrap text-xs">{row.original.userName}</span> : dash),
  },
  {
    id: "filePath",
    accessorKey: "filePath",
    header: "File",
    enableSorting: false,
    meta: { label: "File path", className: "max-w-[240px]" },
    cell: ({ row }) =>
      row.original.filePath ? (
        <span className="block truncate font-mono text-[11px]" title={row.original.filePath}>
          {row.original.filePath}
          {row.original.bytes != null && <span className="ml-1 text-muted-foreground">({formatBytes(row.original.bytes)})</span>}
        </span>
      ) : (
        dash
      ),
  },
  {
    id: "policyReason",
    accessorKey: "policyReason",
    header: "Policy reason",
    enableSorting: false,
    meta: { label: "Policy reason", className: "max-w-[240px]" },
    cell: ({ row }) =>
      row.original.policyReason ? (
        <span className="block truncate text-xs" title={row.original.policyReason}>
          {row.original.policyReason}
        </span>
      ) : (
        dash
      ),
  },
  {
    id: "occurredAt",
    accessorKey: "occurredAt",
    header: "Occurred",
    meta: { label: "Occurred" },
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <RelativeTime value={row.original.occurredAt} className="text-xs" />
        <div className="font-mono text-[10px] text-muted-foreground">{formatDateTimeSeconds(row.original.occurredAt)}</div>
      </div>
    ),
  },
];

export function UsbEventsTab({ deviceId }: { deviceId: string }) {
  const list = useListQuery<UsbEvent>(["devices", deviceId, "usb-events"], `/devices/${deviceId}/usb-events`, {
    initial: { sortBy: "occurredAt", sortOrder: "desc" },
  });

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
      maxHeight="max(22rem, calc(100dvh - 22rem))"
      rowClassName={(r) => (r.eventType === "BLOCKED" ? "bg-sev-critical/6 hover:bg-sev-critical/10" : undefined)}
      empty={{ icon: Usb, title: "No USB activity recorded" }}
    />
  );
}
