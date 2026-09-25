"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Check, ClipboardList, Lock, X } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { usbAccessMeta } from "@/lib/status";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeviceLink, VidPid, durationLabel } from "@/components/usb/usb-utils";
import { UsbDecisionDialog } from "@/components/usb/usb-decision-dialog";
import { USB_ACCESS_STATUSES, type UsbAccessRequest } from "@/types/api";

function ExpiresCell({ r }: { r: UsbAccessRequest }) {
  if (!r.expiresAt) return <span className="text-muted-foreground">—</span>;
  if (r.status !== "APPROVED") return <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.expiresAt)}</span>;
  const left = new Date(r.expiresAt).getTime() - Date.now();
  const soon = left > 0 && left < 60 * 60 * 1000;
  return (
    <div className="whitespace-nowrap">
      <RelativeTime value={r.expiresAt} className={cn("text-xs font-medium", soon ? "text-sev-medium" : "text-sev-none")} />
      <div className="text-[11px] text-muted-foreground">{formatDateTime(r.expiresAt)}</div>
    </div>
  );
}

/**
 * Temporary USB access requests. `mode="admin"` shows requester + approve/deny/revoke actions;
 * `mode="self"` is the employee's own list (server-scoped).
 */
export function UsbRequestsTable({ mode, actions }: { mode: "admin" | "self"; actions?: React.ReactNode }) {
  const { can } = useAuth();
  const canApprove = mode === "admin" && can("usb:approve");
  const confirm = useConfirm();
  const list = useListQuery<UsbAccessRequest>("usb", "/usb/requests", {
    initial: { sortBy: "createdAt", sortOrder: "desc" },
    refetchInterval: 60_000,
  });
  const [decision, setDecision] = React.useState<{ request: UsbAccessRequest | null; mode: "approve" | "deny" }>({ request: null, mode: "approve" });

  const { mutate: revoke } = useApiMutation((r: UsbAccessRequest) => api.post(`/usb/requests/${r.id}/revoke`), {
    success: "Access revoked — the device will be blocked again",
    invalidate: [["usb"]],
  });

  const columns = React.useMemo<ColumnDef<UsbAccessRequest, unknown>[]>(() => {
    const cols: ColumnDef<UsbAccessRequest, unknown>[] = [];
    if (mode === "admin") {
      cols.push({
        id: "requester",
        header: "Requester",
        enableSorting: false,
        meta: { label: "Requester" },
        cell: ({ row }) => (
          <div className="min-w-[140px]">
            <div className="font-medium">{row.original.requester?.displayName ?? "Unknown user"}</div>
            {row.original.requester?.email && <div className="text-xs text-muted-foreground">{row.original.requester.email}</div>}
          </div>
        ),
      });
    }
    cols.push(
      {
        id: "device",
        header: "Endpoint",
        enableSorting: false,
        meta: { label: "Endpoint" },
        cell: ({ row }) => <DeviceLink id={row.original.deviceId} name={row.original.device?.deviceName} className="whitespace-nowrap" />,
      },
      {
        id: "usb",
        header: "USB device",
        enableSorting: false,
        meta: { label: "USB device" },
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <VidPid vendorId={row.original.vendorId} productId={row.original.productId} />
            <div className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground" title={row.original.serialNumber || undefined}>
              {row.original.serialNumber || "any serial"}
            </div>
          </div>
        ),
      },
      {
        id: "reason",
        header: "Reason",
        enableSorting: false,
        meta: { label: "Reason" },
        cell: ({ row }) => (
          <span className="line-clamp-2 min-w-[180px] max-w-[280px] text-xs" title={row.original.reason}>
            {row.original.reason}
          </span>
        ),
      },
      {
        id: "durationHours",
        header: "Duration",
        meta: { label: "Duration" },
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            {durationLabel(row.original.durationHours)}
            {row.original.readOnly && (
              <SimpleTooltip label="Read-only access">
                <span>
                  <Badge tone="neutral" className="px-1">
                    <Lock />
                    <span className="sr-only">Read-only</span>
                  </Badge>
                </span>
              </SimpleTooltip>
            )}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <StatusBadge value={row.original.status} meta={usbAccessMeta} />,
      },
      {
        id: "createdAt",
        header: "Requested",
        meta: { label: "Requested" },
        cell: ({ row }) => <RelativeTime value={row.original.createdAt} className="text-xs" />,
      },
      {
        id: "expiresAt",
        header: "Expires",
        meta: { label: "Expires" },
        cell: ({ row }) => <ExpiresCell r={row.original} />,
      },
      {
        id: "decisionNote",
        header: "Decision",
        enableSorting: false,
        meta: { label: "Decision" },
        cell: ({ row }) => {
          const r = row.original;
          if (!r.decisionNote && !r.approver) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="max-w-[240px]">
              {r.approver && <div className="text-xs font-medium">{r.approver.displayName}</div>}
              {r.decisionNote && (
                <div className="truncate text-xs text-muted-foreground" title={r.decisionNote}>
                  {r.decisionNote}
                </div>
              )}
            </div>
          );
        },
      },
    );
    if (canApprove) {
      cols.push({
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => {
          const r = row.original;
          if (r.status === "PENDING") {
            return (
              <div className="flex justify-end gap-1">
                <Button size="xs" variant="outline" onClick={() => setDecision({ request: r, mode: "approve" })}>
                  <Check className="text-sev-none" /> Approve
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setDecision({ request: r, mode: "deny" })}>
                  <X /> Deny
                </Button>
              </div>
            );
          }
          if (r.status === "APPROVED") {
            return (
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Revoke USB access?",
                      description: `${r.requester?.displayName ?? "The requester"} will lose access to this USB device immediately on ${r.device?.deviceName ?? "the endpoint"}.`,
                      confirmLabel: "Revoke access",
                      destructive: true,
                    });
                    if (ok) revoke(r);
                  }}
                >
                  <Ban /> Revoke
                </Button>
              </div>
            );
          }
          return null;
        },
      });
    }
    return cols;
  }, [mode, canApprove, confirm, revoke]);

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
        rowClassName={(r) => (mode === "admin" && r.status === "PENDING" ? "bg-sev-medium/5" : undefined)}
        search={mode === "admin" ? { value: list.state.search, onChange: list.setSearch, placeholder: "Search requester, reason…" } : undefined}
        columnToggle={mode === "admin"}
        filters={
          <>
            <FilterSelect
              label="Status"
              value={list.state.filters.status as string | undefined}
              onChange={(v) => list.setFilter("status", v)}
              options={enumOptions(USB_ACCESS_STATUSES, (v) => usbAccessMeta[v].label)}
            />
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        actions={actions}
        empty={{
          icon: ClipboardList,
          title: mode === "admin" ? "No access requests" : "You have no USB access requests",
          description: mode === "admin" ? "Requests from users appear here for review." : "Submit a request when you need to use a USB storage device.",
        }}
      />
      {canApprove && <UsbDecisionDialog request={decision.request} mode={decision.mode} onClose={() => setDecision((d) => ({ ...d, request: null }))} />}
    </>
  );
}
