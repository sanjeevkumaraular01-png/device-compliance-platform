"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments, useDeviceSearch, useUserSearch } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { DeviceLink, VidPid, shortId } from "@/components/usb/usb-utils";
import { UsbWhitelistDialog } from "@/components/usb/usb-whitelist-dialog";
import { USB_DEVICE_CLASSES, type UsbDevice, type WhitelistScope } from "@/types/api";

const WHITELISTED_ONLY = { isWhitelisted: true };

const scopeTone: Record<WhitelistScope, Tone> = { GLOBAL: "primary", DEPARTMENT: "info", USER: "low", DEVICE: "neutral" };

export function UsbWhitelistTab() {
  const { can } = useAuth();
  const canWrite = can("usb:write");
  const confirm = useConfirm();
  const list = useListQuery<UsbDevice>("usb", "/usb/devices", {
    initial: { sortBy: "approvedAt", sortOrder: "desc" },
    fixedParams: WHITELISTED_ONLY,
  });

  const [dialog, setDialog] = React.useState<{ open: boolean; device: UsbDevice | null }>({ open: false, device: null });

  // Resolve scope references to names where cheap lookups allow it.
  const hasDept = list.rows.some((r) => r.whitelistScope === "DEPARTMENT");
  const hasUser = list.rows.some((r) => r.whitelistScope === "USER");
  const hasDevice = list.rows.some((r) => r.whitelistScope === "DEVICE");
  const departments = useDepartments(hasDept);
  const users = useUserSearch("", hasUser);
  const devices = useDeviceSearch("", hasDevice);
  const names = React.useMemo(() => {
    const m = new Map<string, string>();
    departments.data?.forEach((d) => m.set(d.id, d.name));
    users.data?.forEach((u) => m.set(u.id, u.displayName));
    devices.data?.forEach((d) => m.set(d.id, d.deviceName));
    return m;
  }, [departments.data, users.data, devices.data]);

  const { mutate: removeDevice } = useApiMutation((d: UsbDevice) => api.delete(`/usb/devices/${d.id}`), {
    success: "Device removed from the whitelist",
    invalidate: [["usb"]],
  });

  const columns = React.useMemo<ColumnDef<UsbDevice, unknown>[]>(
    () => [
      {
        id: "productName",
        header: "Device",
        meta: { label: "Device" },
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="min-w-[160px]">
              <div className="font-medium">{d.productName || "Unnamed device"}</div>
              <div className="text-xs text-muted-foreground">{d.manufacturer || "Unknown manufacturer"}</div>
            </div>
          );
        },
      },
      {
        id: "vendorId",
        header: "VID:PID",
        meta: { label: "VID:PID" },
        cell: ({ row }) => <VidPid vendorId={row.original.vendorId} productId={row.original.productId} />,
      },
      {
        id: "serialNumber",
        header: "Serial",
        meta: { label: "Serial" },
        cell: ({ row }) =>
          row.original.serialNumber ? (
            <span className="block max-w-[160px] truncate font-mono text-xs" title={row.original.serialNumber}>
              {row.original.serialNumber}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Any unit</span>
          ),
      },
      {
        id: "deviceClass",
        header: "Class",
        meta: { label: "Class" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{humanize(row.original.deviceClass)}</span>,
      },
      {
        id: "whitelistScope",
        header: "Scope",
        meta: { label: "Scope" },
        cell: ({ row }) => {
          const d = row.original;
          const ref = d.scopeRefId;
          const name = ref ? names.get(ref) : undefined;
          return (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <Badge tone={scopeTone[d.whitelistScope]}>{humanize(d.whitelistScope)}</Badge>
              {ref &&
                (d.whitelistScope === "DEVICE" ? (
                  <DeviceLink id={ref} name={name} className="text-xs" />
                ) : name ? (
                  <span className="text-xs">{name}</span>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground" title={ref}>
                    {shortId(ref)}
                  </span>
                ))}
            </div>
          );
        },
      },
      {
        id: "readOnly",
        header: "Access",
        meta: { label: "Access" },
        cell: ({ row }) =>
          row.original.readOnly ? (
            <Badge tone="medium">
              <Lock /> Read-only
            </Badge>
          ) : (
            <Badge tone="success">Read / write</Badge>
          ),
      },
      {
        id: "approvedAt",
        header: "Approved",
        meta: { label: "Approved" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.approvedAt)}</span>,
      },
      {
        id: "notes",
        header: "Notes",
        enableSorting: false,
        meta: { label: "Notes" },
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="block max-w-[240px] truncate text-xs text-muted-foreground" title={row.original.notes}>
              {row.original.notes}
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
              cell: ({ row }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Whitelist entry actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setDialog({ open: true, device: row.original })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={async () => {
                        const d = row.original;
                        const ok = await confirm({
                          title: "Remove from whitelist?",
                          description: (
                            <>
                              <span className="font-medium text-foreground">{d.productName || `${d.vendorId}:${d.productId}`}</span> will be blocked again on
                              endpoints where USB storage is restricted.
                            </>
                          ),
                          confirmLabel: "Remove",
                          destructive: true,
                        });
                        if (ok) removeDevice(d);
                      }}
                    >
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies ColumnDef<UsbDevice, unknown>,
          ]
        : []),
    ],
    [canWrite, names, confirm, removeDevice],
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
        getRowId={(r) => r.id}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search product, serial…" }}
        filters={
          <>
            <FilterSelect
              label="Class"
              value={list.state.filters.deviceClass as string | undefined}
              onChange={(v) => list.setFilter("deviceClass", v)}
              options={enumOptions(USB_DEVICE_CLASSES, humanize)}
            />
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setDialog({ open: true, device: null })}>
              <Plus /> Add device
            </Button>
          ) : undefined
        }
        empty={{
          icon: ShieldCheck,
          title: "No whitelisted USB devices",
          description: "Approved devices bypass the USB storage block for their scope.",
        }}
      />
      {canWrite && <UsbWhitelistDialog open={dialog.open} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} device={dialog.device} />}
    </>
  );
}
