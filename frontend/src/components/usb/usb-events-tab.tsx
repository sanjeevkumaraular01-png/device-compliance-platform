"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, ShieldCheck, Usb } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, DateRangeFilter, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useListQuery } from "@/hooks/use-list-query";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/lib/auth";
import { usbEventMeta } from "@/lib/status";
import { formatBytes, formatDateTimeSeconds, humanize } from "@/lib/format";
import { DeviceLink, VidPid } from "@/components/usb/usb-utils";
import { UsbWhitelistDialog, type UsbWhitelistPrefill } from "@/components/usb/usb-whitelist-dialog";
import { USB_EVENT_TYPES, type UsbEvent } from "@/types/api";

function dayStartIso(d: string | undefined) {
  return d ? new Date(`${d}T00:00:00`).toISOString() : undefined;
}
function dayEndIso(d: string | undefined) {
  return d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined;
}

export function UsbEventsTab() {
  const { can } = useAuth();
  const canWrite = can("usb:write");
  const list = useListQuery<UsbEvent>("usb", "/usb/events", {
    initial: { sortBy: "occurredAt", sortOrder: "desc" },
    refetchInterval: 60_000,
  });
  const { setFilter, clearFilters } = list;

  const [range, setRange] = React.useState<{ from?: string; to?: string }>({});
  const [vendor, setVendor] = React.useState("");
  const debVendor = useDebounce(vendor.trim().replace(/^0x/i, "").toLowerCase(), 400);
  React.useEffect(() => {
    setFilter("vendorId", debVendor || undefined);
  }, [debVendor, setFilter]);

  const [prefill, setPrefill] = React.useState<UsbWhitelistPrefill | null>(null);

  const columns = React.useMemo<ColumnDef<UsbEvent, unknown>[]>(
    () => [
      {
        id: "occurredAt",
        header: "Time",
        meta: { label: "Time" },
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <div className="text-xs">{formatDateTimeSeconds(row.original.occurredAt)}</div>
            <RelativeTime value={row.original.occurredAt} className="text-[11px] text-muted-foreground" />
          </div>
        ),
      },
      {
        id: "device",
        header: "Endpoint",
        enableSorting: false,
        meta: { label: "Endpoint" },
        cell: ({ row }) => <DeviceLink id={row.original.deviceId} name={row.original.device?.deviceName} className="whitespace-nowrap" />,
      },
      {
        id: "eventType",
        header: "Event",
        meta: { label: "Event" },
        cell: ({ row }) => <StatusBadge value={row.original.eventType} meta={usbEventMeta} />,
      },
      {
        id: "deviceClass",
        header: "Class",
        meta: { label: "Class" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{humanize(row.original.deviceClass)}</span>,
      },
      {
        id: "vidpid",
        header: "VID:PID",
        enableSorting: false,
        meta: { label: "VID:PID" },
        cell: ({ row }) => <VidPid vendorId={row.original.vendorId} productId={row.original.productId} />,
      },
      {
        id: "serialNumber",
        header: "Serial",
        enableSorting: false,
        meta: { label: "Serial" },
        cell: ({ row }) =>
          row.original.serialNumber ? (
            <span className="block max-w-[160px] truncate font-mono text-xs" title={row.original.serialNumber}>
              {row.original.serialNumber}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "label",
        header: "Volume",
        enableSorting: false,
        meta: { label: "Volume label" },
        cell: ({ row }) => row.original.label || <span className="text-muted-foreground">—</span>,
      },
      {
        id: "userName",
        header: "User",
        meta: { label: "User" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.userName || <span className="text-muted-foreground">—</span>}</span>,
      },
      {
        id: "filePath",
        header: "File",
        enableSorting: false,
        meta: { label: "File path" },
        cell: ({ row }) =>
          row.original.filePath ? (
            <span className="block max-w-[220px] truncate font-mono text-xs" title={row.original.filePath}>
              {row.original.filePath}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "bytes",
        header: "Size",
        enableSorting: false,
        meta: { label: "Size", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => (row.original.bytes !== null && row.original.bytes !== undefined ? formatBytes(row.original.bytes) : <span className="text-muted-foreground">—</span>),
      },
      {
        id: "policyReason",
        header: "Policy reason",
        enableSorting: false,
        meta: { label: "Policy reason" },
        cell: ({ row }) =>
          row.original.policyReason ? (
            <span className="block max-w-[260px] truncate text-xs text-muted-foreground" title={row.original.policyReason}>
              {row.original.policyReason}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              header: "",
              enableSorting: false,
              enableHiding: false,
              meta: { className: "w-10 text-right" },
              cell: ({ row }) => {
                const e = row.original;
                if (!e.vendorId || !e.productId) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label="Event actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          setPrefill({
                            vendorId: e.vendorId ?? "",
                            productId: e.productId ?? "",
                            serialNumber: e.serialNumber ?? undefined,
                            productName: e.label ?? undefined,
                            deviceClass: e.deviceClass,
                          })
                        }
                      >
                        <ShieldCheck /> Whitelist this device
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              },
            } satisfies ColumnDef<UsbEvent, unknown>,
          ]
        : []),
    ],
    [canWrite],
  );

  const clearAll = () => {
    setRange({});
    setVendor("");
    clearFilters();
  };

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
        getRowId={(r) => r.id}
        rowClassName={(r) => (r.eventType === "BLOCKED" ? "bg-sev-critical/5 hover:bg-sev-critical/10" : undefined)}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search device, user, file…" }}
        initialColumnVisibility={{ label: false }}
        filters={
          <>
            <FilterSelect
              label="Event"
              value={list.state.filters.eventType as string | undefined}
              onChange={(v) => setFilter("eventType", v)}
              options={enumOptions(USB_EVENT_TYPES, (v) => usbEventMeta[v].label)}
            />
            <DateRangeFilter
              from={range.from}
              to={range.to}
              onChange={(r) => {
                setRange(r);
                setFilter("from", dayStartIso(r.from));
                setFilter("to", dayEndIso(r.to));
              }}
            />
            <Input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Vendor ID"
              aria-label="Filter by vendor ID"
              className="h-8 w-28 font-mono text-xs"
              maxLength={6}
            />
            <ClearFiltersButton count={list.activeFilterCount + (list.state.search ? 1 : 0)} onClear={clearAll} />
          </>
        }
        empty={{ icon: Usb, title: "No USB events", description: "No USB activity matches the current filters." }}
      />
      {canWrite && <UsbWhitelistDialog open={!!prefill} onOpenChange={(o) => !o && setPrefill(null)} prefill={prefill} />}
    </>
  );
}
