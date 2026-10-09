"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { IdCard, Laptop, MoreHorizontal, Send, Signature, UserMinus } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/data-table/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { AcknowledgementStatus, HrDirectoryRow, OffboardResult } from "@/types/api";
import { OnboardDialog } from "./onboard-dialog";
import { SignaturesDialog } from "./signatures-dialog";

const ACK_META: Record<AcknowledgementStatus, { label: string; tone: Tone }> = {
  SIGNED: { label: "Signed", tone: "success" },
  OUTDATED: { label: "Old version", tone: "medium" },
  NONE: { label: "Not signed", tone: "high" },
  NOT_REQUIRED: { label: "No notice yet", tone: "neutral" },
};

const DEVICE_TONE: Record<string, Tone> = { ACTIVE: "success", PENDING: "medium", INACTIVE: "neutral", QUARANTINED: "critical" };

export function DirectoryTab() {
  const { can } = useAuth();
  const canWrite = can("users:write");
  const confirm = useConfirm();
  const departments = useDepartments();
  const [onboarding, setOnboarding] = React.useState<HrDirectoryRow | null>(null);
  const [signatures, setSignatures] = React.useState<HrDirectoryRow | null>(null);

  const list = useListQuery<HrDirectoryRow>(["hr", "directory"], "/hr/directory", {
    initial: { sortBy: "displayName", sortOrder: "asc", filters: { status: "active" } },
  });
  const f = list.state.filters;

  const offboard = useApiMutation(
    (vars: { id: string; reason?: string }) => api.post<OffboardResult>(`/hr/employees/${vars.id}/offboard`, { reason: vars.reason }),
    {
      success: (r) =>
        r?.failedDevices.length
          ? `Offboarded, but ${r.failedDevices.length} device(s) could not be retired — retire them from Devices`
          : `Offboarded: ${r?.retiredDevices.length ?? 0} device(s) retired, account deactivated`,
      invalidate: [["hr"], ["users"], ["devices"]],
    },
  );
  const runOffboard = offboard.mutate;

  const onOffboard = React.useCallback(
    async (e: HrDirectoryRow) => {
      const ok = await confirm({
        title: `Offboard ${e.displayName}?`,
        description: (
          <div className="grid gap-2 text-sm">
            <p>This is for leavers. It will:</p>
            <ul className="list-disc pl-5">
              <li>
                Retire {e.assignedDevices.length ? <b>{e.assignedDevices.map((d) => d.deviceName).join(", ")}</b> : "their devices (none assigned)"} — the agent
                stops reporting and its token and certificates are revoked
              </li>
              <li>Cancel any unused enrollment links</li>
              <li>Deactivate their account and sign them out everywhere</li>
            </ul>
            <p className="text-xs text-muted-foreground">History (signatures, audit log, past device data) is kept.</p>
          </div>
        ),
        confirmLabel: "Offboard employee",
        destructive: true,
        typeToConfirm: e.employeeCode ?? e.email,
      });
      if (ok) runOffboard({ id: e.id, reason: "Offboarded from HR page" });
    },
    [confirm, runOffboard],
  );

  const columns = React.useMemo<ColumnDef<HrDirectoryRow, unknown>[]>(() => {
    const cols: ColumnDef<HrDirectoryRow, unknown>[] = [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: "Employee",
        enableHiding: false,
        meta: { label: "Employee", className: "min-w-[200px]" },
        cell: ({ row: { original: e } }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{e.displayName}</span>
              {!e.isActive && <Badge variant="secondary">Inactive</Badge>}
            </div>
            <div className="truncate text-xs text-muted-foreground">{e.email}</div>
          </div>
        ),
      },
      {
        id: "employeeCode",
        accessorKey: "employeeCode",
        header: "Employee ID",
        meta: { label: "Employee ID" },
        cell: ({ row }) =>
          row.original.employeeCode ? (
            <span className="font-mono text-xs">{row.original.employeeCode}</span>
          ) : (
            <span className="text-xs text-sev-medium">Not set</span>
          ),
      },
      {
        id: "department",
        header: "Department",
        enableSorting: false,
        meta: { label: "Department" },
        cell: ({ row }) => <span className="text-sm">{row.original.department?.name ?? "—"}</span>,
      },
      {
        id: "jobTitle",
        accessorKey: "jobTitle",
        header: "Designation",
        enableSorting: false,
        meta: { label: "Designation" },
        cell: ({ row }) => <span className="text-sm">{row.original.jobTitle ?? "—"}</span>,
      },
      {
        id: "workProfile",
        header: "Work profile",
        enableSorting: false,
        meta: { label: "Work profile" },
        cell: ({ row }) => (row.original.workProfile ? <Badge variant="outline">{row.original.workProfile.name}</Badge> : <span className="text-xs text-muted-foreground">—</span>),
      },
      {
        id: "devices",
        header: "Laptops",
        enableSorting: false,
        meta: { label: "Laptops" },
        cell: ({ row }) =>
          row.original.assignedDevices.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.assignedDevices.map((d) => (
                <Link key={d.id} href={`/devices/${d.id}`} onClick={(ev) => ev.stopPropagation()}>
                  <Badge tone={DEVICE_TONE[d.status] ?? "neutral"} className="gap-1 hover:underline">
                    <Laptop className="size-3" />
                    {d.deviceName}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          ),
      },
      {
        id: "acknowledgement",
        header: "Notice",
        enableSorting: false,
        meta: { label: "Notice" },
        cell: ({ row }) => {
          const a = row.original.acknowledgement;
          const m = ACK_META[a.status];
          return (
            <div className="grid gap-0.5">
              <Badge tone={m.tone}>{m.label}</Badge>
              {a.latest && (
                <span className="text-[11px] text-muted-foreground">
                  v{a.latest.noticeVersion} · {formatDate(a.latest.acknowledgedAt)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row: { original: e } }) => (
          <div onClick={(ev) => ev.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${e.displayName}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{e.displayName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {canWrite && e.isActive && (
                  <DropdownMenuItem onSelect={() => setTimeout(() => setOnboarding(e), 0)}>
                    <Send /> Send enrollment link
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setTimeout(() => setSignatures(e), 0)}>
                  <Signature /> Notice signatures
                </DropdownMenuItem>
                {canWrite && e.isActive && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setTimeout(() => void onOffboard(e), 0)}>
                      <UserMinus /> Offboard…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];
    return cols;
  }, [canWrite, onOffboard]);

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
        rowClassName={(r) => (r.isActive ? undefined : "opacity-60")}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search name, email, Employee ID…" }}
        filters={
          <>
            <FilterSelect
              label="Department"
              value={f.departmentId as string | undefined}
              onChange={(v) => list.setFilter("departmentId", v)}
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            />
            <FilterSelect
              label="Notice"
              value={f.acknowledgement as string | undefined}
              onChange={(v) => list.setFilter("acknowledgement", v)}
              options={[
                { value: "signed", label: "Signed current version" },
                { value: "pending", label: "Not signed yet" },
              ]}
            />
            <FilterSelect
              label="Status"
              value={f.status as string | undefined}
              allLabel="All"
              onChange={(v) => list.setFilter("status", v ?? "all")}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive / left" },
              ]}
            />
          </>
        }
        empty={{
          icon: IdCard,
          title: list.state.search ? "No matching employees" : "No employees yet",
          description: "Add employees on the Users page or import them from your HR system (Users → Import CSV).",
        }}
      />
      <OnboardDialog employee={onboarding} onOpenChange={(o) => !o && setOnboarding(null)} />
      <SignaturesDialog employee={signatures} onOpenChange={(o) => !o && setSignatures(null)} />
    </>
  );
}
