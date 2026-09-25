"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ShieldQuestion, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Can, useAuth } from "@/lib/auth";
import type { Device } from "@/types/api";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Mono, RelativeTime } from "@/components/common/misc";
import { OsIcon } from "@/components/common/os-icon";
import { formatRam, formatStorage } from "@/lib/format";
import { usePendingDevices } from "@/components/enrollment/enrollment-queries";

function join(parts: (string | null | undefined)[], sep = " "): string {
  return parts.filter((p): p is string => !!p && p.trim() !== "").join(sep);
}

export function PendingTab() {
  const pending = usePendingDevices();
  const confirm = useConfirm();
  const { can } = useAuth();
  const [search, setSearch] = React.useState("");

  const decide = useApiMutation(
    ({ device, action }: { device: Device; action: "approve" | "reject" }) => api.post(`/enrollment/devices/${device.id}/${action}`),
    {
      success: (_d, v) => (v.action === "approve" ? `${v.device.deviceName} approved and activated` : `${v.device.deviceName} rejected`),
      invalidate: [["enrollment"], ["devices"], ["dashboard"]],
    },
  );

  const onDecide = React.useCallback(
    async (device: Device, action: "approve" | "reject") => {
      const ok = await confirm(
        action === "approve"
          ? {
              title: `Approve ${device.deviceName}?`,
              description: "The device becomes ACTIVE, receives its policy and starts reporting inventory and compliance.",
              confirmLabel: "Approve device",
            }
          : {
              title: `Reject ${device.deviceName}?`,
              description: "The enrollment is refused and the agent credentials are revoked. The device must re-enroll to be managed.",
              confirmLabel: "Reject device",
              destructive: true,
            },
      );
      if (ok) decide.mutate({ device, action });
    },
    [confirm, decide],
  );

  const rows = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = pending.data ?? [];
    if (!s) return all;
    return all.filter((d) =>
      [d.deviceName, d.hostname, d.serialNumber, d.ipAddress, d.manufacturer, d.model].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [pending.data, search]);

  const busyId = decide.isPending ? decide.variables?.device.id : undefined;
  const canOpenDevice = can("devices:read");

  const columns = React.useMemo<ColumnDef<Device, unknown>[]>(
    () => [
      {
        id: "deviceName",
        accessorKey: "deviceName",
        header: "Device",
        meta: { label: "Device" },
        cell: ({ row }) => (
          <div className="min-w-[140px]">
            {canOpenDevice ? (
              <Link href={`/devices/${row.original.id}`} className="font-medium hover:text-primary hover:underline">
                {row.original.deviceName}
              </Link>
            ) : (
              <span className="font-medium">{row.original.deviceName}</span>
            )}
            {row.original.hostname && row.original.hostname !== row.original.deviceName && (
              <div className="text-xs text-muted-foreground">{row.original.hostname}</div>
            )}
          </div>
        ),
      },
      {
        id: "serialNumber",
        accessorKey: "serialNumber",
        header: "Serial",
        meta: { label: "Serial" },
        cell: ({ row }) => <Mono>{row.original.serialNumber}</Mono>,
      },
      {
        id: "platform",
        accessorKey: "platform",
        header: "Platform",
        meta: { label: "Platform" },
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <OsIcon platform={row.original.platform} withLabel />
            {row.original.osVersion && <div className="text-xs text-muted-foreground">{join([row.original.osName, row.original.osVersion])}</div>}
          </div>
        ),
      },
      {
        id: "hardware",
        header: "Hardware",
        enableSorting: false,
        meta: { label: "Hardware" },
        cell: ({ row }) => {
          const d = row.original;
          const model = join([d.manufacturer, d.model]);
          const specs = join([d.cpu, d.ramMb ? formatRam(d.ramMb) : null, d.storageGb ? formatStorage(d.storageGb) : null], " · ");
          return (
            <div className="min-w-[160px] max-w-[280px]">
              <div className="truncate">{model || <span className="text-muted-foreground">Unknown model</span>}</div>
              {specs && <div className="truncate text-xs text-muted-foreground" title={specs}>{specs}</div>}
            </div>
          );
        },
      },
      {
        id: "ipAddress",
        accessorKey: "ipAddress",
        header: "IP address",
        meta: { label: "IP address" },
        cell: ({ row }) => (row.original.ipAddress ? <Mono>{row.original.ipAddress}</Mono> : <span className="text-muted-foreground">—</span>),
      },
      {
        id: "enrolledAt",
        header: "Enrolled",
        accessorFn: (d) => d.enrolledAt ?? d.createdAt,
        meta: { label: "Enrolled" },
        cell: ({ row }) => <RelativeTime value={row.original.enrolledAt ?? row.original.createdAt} className="text-xs" />,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px" },
        cell: ({ row }) => (
          <Can permission="enrollment:manage">
            <div className="flex justify-end gap-1.5">
              <Button size="xs" onClick={() => onDecide(row.original, "approve")} disabled={busyId === row.original.id}>
                <Check /> Approve
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDecide(row.original, "reject")}
                disabled={busyId === row.original.id}
              >
                <X /> Reject
              </Button>
            </div>
          </Can>
        ),
      },
    ],
    [onDecide, busyId, canOpenDevice],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={pending.isLoading}
      fetching={pending.isFetching}
      error={pending.error}
      onRetry={() => pending.refetch()}
      getRowId={(d) => d.id}
      search={{ value: search, onChange: setSearch, placeholder: "Search name, serial, IP…" }}
      empty={{
        icon: ShieldQuestion,
        title: search ? "No pending devices match" : "No devices awaiting approval",
        description: "Devices enrolled with a token that has auto-approve turned off appear here for verification.",
      }}
    />
  );
}
