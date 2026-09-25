"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, Download, FileCheck2, Laptop, Plus, ScrollText, Send } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { PageHeader } from "@/components/common/page-header";
import { ComplianceBadge, RiskBadge, StatusBadge } from "@/components/common/status-badges";
import { ScoreRing } from "@/components/common/score-ring";
import { OsIcon } from "@/components/common/os-icon";
import { OnlineDot, RelativeTime } from "@/components/common/misc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments, usePolicies } from "@/hooks/use-lookups";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { complianceMeta, deviceStatusMeta, riskMeta } from "@/lib/status";
import { formatDateTime, humanize, platformLabel } from "@/lib/format";
import { downloadCsv } from "@/lib/utils";
import {
  COMPLIANCE_STATES,
  DEVICE_STATUSES,
  OS_PLATFORMS,
  RISK_LEVELS,
  type CommandType,
  type Device,
} from "@/types/api";
import { AddDeviceDialog, AssignPolicyDialog } from "@/components/devices/device-dialogs";
import { COMMAND_PRESETS, commandPayload, policyVersionFor } from "@/components/devices/device-commands";

const HIDDEN_BY_DEFAULT = { ipAddress: false, serialNumber: false, deviceType: false };

export function DevicesList() {
  const { user, can } = useAuth();
  const isEmployee = user?.role === "EMPLOYEE";
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get("search");

  const list = useListQuery<Device>("devices", "/devices", {
    initial: { sortBy: "lastSeenAt", sortOrder: "desc", search: urlSearch ?? "" },
  });

  // The ⌘K palette may navigate here again with a different ?search= while the page is mounted.
  const { setSearch } = list;
  React.useEffect(() => {
    if (urlSearch !== null) setSearch(urlSearch);
  }, [urlSearch, setSearch]);

  const departments = useDepartments(!isEmployee);
  const canCommand = can("devices:command");
  const canEvaluate = can("compliance:write");
  const canAssignPolicy = can("policies:write");
  const canWrite = can("devices:write");
  const bulkEnabled = !isEmployee && (canCommand || canEvaluate || canAssignPolicy);

  const [addOpen, setAddOpen] = React.useState(false);

  const columns = React.useMemo<ColumnDef<Device, unknown>[]>(
    () => [
      {
        id: "deviceName",
        accessorKey: "deviceName",
        header: "Device",
        enableHiding: false,
        meta: { label: "Device", className: "min-w-[200px]" },
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="min-w-0">
              <Link href={`/devices/${d.id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                {d.deviceName}
              </Link>
              <div className="truncate font-mono text-[11px] text-muted-foreground">{[d.hostname, d.serialNumber].filter(Boolean).join(" · ")}</div>
            </div>
          );
        },
      },
      {
        id: "platform",
        accessorKey: "platform",
        header: "OS",
        meta: { label: "Operating system", className: "min-w-[150px]" },
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <OsIcon platform={d.platform} />
              <div className="min-w-0">
                <div className="truncate text-sm">{d.osName ?? platformLabel[d.platform]}</div>
                <div className="truncate text-[11px] text-muted-foreground">{d.osVersion ?? "—"}</div>
              </div>
            </div>
          );
        },
      },
      {
        id: "complianceScore",
        accessorKey: "complianceScore",
        header: "Compliance",
        meta: { label: "Compliance" },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <ScoreRing score={row.original.complianceState === "UNKNOWN" ? null : row.original.complianceScore} size={30} />
            <ComplianceBadge value={row.original.complianceState} />
          </div>
        ),
      },
      {
        id: "riskLevel",
        accessorKey: "riskLevel",
        header: "Risk",
        meta: { label: "Risk" },
        cell: ({ row }) => <RiskBadge value={row.original.riskLevel} />,
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <StatusBadge value={row.original.status} meta={deviceStatusMeta} />,
      },
      {
        id: "assignedUser",
        header: "Assigned user",
        enableSorting: false,
        meta: { label: "Assigned user", className: "max-w-[180px]" },
        cell: ({ row }) => {
          const u = row.original.assignedUser;
          if (!u) return <span className="text-xs text-muted-foreground">Unassigned</span>;
          return (
            <div className="min-w-0">
              <div className="truncate text-sm">{u.displayName}</div>
              <div className="truncate text-[11px] text-muted-foreground">{u.email}</div>
            </div>
          );
        },
      },
      {
        id: "department",
        header: "Department",
        enableSorting: false,
        meta: { label: "Department" },
        cell: ({ row }) => row.original.department?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "lastSeenAt",
        accessorKey: "lastSeenAt",
        header: "Last seen",
        meta: { label: "Last seen" },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <OnlineDot online={row.original.online} />
            <RelativeTime value={row.original.lastSeenAt} className="text-xs" />
          </div>
        ),
      },
      {
        id: "agentVersion",
        accessorKey: "agentVersion",
        header: "Agent",
        meta: { label: "Agent version" },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.agentVersion ?? "—"}</span>,
      },
      {
        id: "ipAddress",
        accessorKey: "ipAddress",
        header: "IP address",
        meta: { label: "IP address" },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.ipAddress ?? "—"}</span>,
      },
      {
        id: "serialNumber",
        accessorKey: "serialNumber",
        header: "Serial",
        meta: { label: "Serial number" },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.serialNumber}</span>,
      },
      {
        id: "deviceType",
        accessorKey: "deviceType",
        header: "Type",
        meta: { label: "Device type" },
        cell: ({ row }) => humanize(row.original.deviceType),
      },
    ],
    [],
  );

  const exportCsv = () => {
    if (list.rows.length === 0) {
      toast.info("Nothing to export on this page");
      return;
    }
    downloadCsv(
      `devices-page-${list.meta?.page ?? 1}.csv`,
      list.rows.map((d) => ({
        deviceName: d.deviceName,
        hostname: d.hostname,
        serialNumber: d.serialNumber,
        assetId: d.assetId,
        platform: platformLabel[d.platform] ?? d.platform,
        osVersion: [d.osName, d.osVersion, d.osBuild].filter(Boolean).join(" "),
        complianceState: complianceMeta[d.complianceState]?.label ?? d.complianceState,
        complianceScore: d.complianceScore,
        riskLevel: riskMeta[d.riskLevel]?.label ?? d.riskLevel,
        status: deviceStatusMeta[d.status]?.label ?? d.status,
        assignedUser: d.assignedUser?.displayName ?? "",
        assignedEmail: d.assignedUser?.email ?? "",
        department: d.department?.name ?? "",
        lastSeenAt: formatDateTime(d.lastSeenAt),
        online: d.online ? "Online" : "Offline",
        agentVersion: d.agentVersion,
        ipAddress: d.ipAddress,
        deviceType: humanize(d.deviceType),
      })),
      [
        { key: "deviceName", header: "Device name" },
        { key: "hostname", header: "Hostname" },
        { key: "serialNumber", header: "Serial number" },
        { key: "assetId", header: "Asset ID" },
        { key: "platform", header: "Platform" },
        { key: "osVersion", header: "OS version" },
        { key: "complianceState", header: "Compliance" },
        { key: "complianceScore", header: "Score" },
        { key: "riskLevel", header: "Risk" },
        { key: "status", header: "Status" },
        { key: "assignedUser", header: "Assigned user" },
        { key: "assignedEmail", header: "User email" },
        { key: "department", header: "Department" },
        { key: "lastSeenAt", header: "Last seen" },
        { key: "online", header: "Online" },
        { key: "agentVersion", header: "Agent version" },
        { key: "ipAddress", header: "IP address" },
        { key: "deviceType", header: "Device type" },
      ],
    );
  };

  const f = list.state.filters;
  const filterValue = (k: string) => (f[k] === undefined ? undefined : String(f[k]));

  return (
    <>
      <PageHeader
        title={isEmployee ? "My Devices" : "Devices"}
        icon={Laptop}
        description={
          isEmployee
            ? "Computers assigned to you and their security & compliance status."
            : "Managed endpoints across the organization — inventory, compliance posture and remote actions."
        }
        actions={
          !isEmployee && canWrite ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> Add device
            </Button>
          ) : undefined
        }
      />

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
        getRowId={(d) => d.id}
        enableSelection={bulkEnabled}
        bulkActions={bulkEnabled ? (selected, clear) => <BulkActions selected={selected} clear={clear} /> : undefined}
        initialColumnVisibility={HIDDEN_BY_DEFAULT}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search name, hostname, serial, user…" }}
        filters={
          <>
            <FilterSelect label="Platform" value={filterValue("platform")} onChange={(v) => list.setFilter("platform", v)} options={enumOptions(OS_PLATFORMS, (p) => platformLabel[p])} />
            <FilterSelect
              label="Compliance"
              value={filterValue("complianceState")}
              onChange={(v) => list.setFilter("complianceState", v)}
              options={enumOptions(COMPLIANCE_STATES, (s) => complianceMeta[s].label)}
            />
            <FilterSelect label="Risk" value={filterValue("riskLevel")} onChange={(v) => list.setFilter("riskLevel", v)} options={enumOptions(RISK_LEVELS, (r) => riskMeta[r].label)} />
            <FilterSelect label="Status" value={filterValue("status")} onChange={(v) => list.setFilter("status", v)} options={enumOptions(DEVICE_STATUSES, (s) => deviceStatusMeta[s].label)} />
            {!isEmployee && (departments.data?.length ?? 0) > 0 && (
              <FilterSelect
                label="Department"
                value={filterValue("departmentId")}
                onChange={(v) => list.setFilter("departmentId", v)}
                options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
            <FilterSelect
              label="Connectivity"
              value={filterValue("online")}
              onChange={(v) => list.setFilter("online", v)}
              options={[
                { value: "true", label: "Online" },
                { value: "false", label: "Offline" },
              ]}
            />
            <ClearFiltersButton count={list.activeFilterCount + (list.state.search ? 1 : 0)} onClear={list.clearFilters} />
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download /> <span className="hidden sm:inline">Export CSV</span>
          </Button>
        }
        empty={{
          icon: Laptop,
          title: list.activeFilterCount || list.state.search ? "No devices match your filters" : isEmployee ? "No devices assigned to you" : "No devices yet",
          description:
            list.activeFilterCount || list.state.search
              ? "Try removing a filter or changing the search."
              : isEmployee
                ? "Contact IT if you believe a device should be assigned to you."
                : "Create an enrollment token and install the agent, or pre-register an asset.",
        }}
      />

      {canWrite && !isEmployee && <AddDeviceDialog open={addOpen} onOpenChange={setAddOpen} />}
    </>
  );
}

function BulkActions({ selected, clear }: { selected: Device[]; clear: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const policies = usePolicies(can("devices:command"));
  const [policyOpen, setPolicyOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const ids = selected.map((d) => d.id);
  const n = selected.length;
  const plural = n === 1 ? "" : "s";

  const evaluate = useApiMutation((deviceIds: string[]) => api.post<{ queued: number }>("/compliance/evaluate", { deviceIds }), {
    success: (res, vars) => `Queued ${res?.queued ?? vars.length} compliance evaluation${(res?.queued ?? vars.length) === 1 ? "" : "s"}`,
    invalidate: [["compliance"]],
    onSuccess: () => clear(),
  });

  const sendCommand = async (type: CommandType, label: string, needsConfirm?: boolean) => {
    if (needsConfirm || n > 1) {
      const ok = await confirm({
        title: `${label} on ${n} device${plural}?`,
        description:
          type === "RESTART"
            ? "Each device reboots 60 seconds after it receives the command. Unsaved work on those devices will be lost."
            : "The command is queued and delivered on each agent's next check-in.",
        confirmLabel: `Send to ${n} device${plural}`,
        destructive: type === "RESTART",
      });
      if (!ok) return;
    }
    setSending(true);
    const results = await Promise.allSettled(
      selected.map((d) =>
        api.post(`/devices/${d.id}/commands`, { type, payload: commandPayload(type, { policyVersion: policyVersionFor(d.policyId, policies.data) }) }),
      ),
    );
    setSending(false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    if (failed === 0) toast.success(`${label} queued on ${ok} device${ok === 1 ? "" : "s"}`);
    else if (ok === 0) toast.error(`${label} failed on all ${failed} device${failed === 1 ? "" : "s"}`);
    else toast.warning(`${label} queued on ${ok} device${ok === 1 ? "" : "s"}, failed on ${failed}`);
    void qc.invalidateQueries({ queryKey: ["devices"] });
    if (ok > 0) clear();
  };

  return (
    <>
      {can("compliance:write") && (
        <Button variant="outline" size="xs" loading={evaluate.isPending} onClick={() => evaluate.mutate(ids)}>
          <FileCheck2 /> Evaluate compliance
        </Button>
      )}
      {can("devices:command") && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs" loading={sending}>
              <Send /> Send command <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              Queue on {n} device{plural}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COMMAND_PRESETS.map((p) => (
              <DropdownMenuItem key={p.type} destructive={p.type === "RESTART"} onSelect={() => setTimeout(() => void sendCommand(p.type, p.label, p.confirm), 0)}>
                <div className="grid">
                  <span>{p.label}</span>
                  <span className="text-[11px] text-muted-foreground">{p.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {can("policies:write") && (
        <>
          <Button variant="outline" size="xs" onClick={() => setPolicyOpen(true)}>
            <ScrollText /> Assign policy
          </Button>
          <AssignPolicyDialog deviceIds={ids} open={policyOpen} onOpenChange={setPolicyOpen} onDone={clear} />
        </>
      )}
    </>
  );
}
