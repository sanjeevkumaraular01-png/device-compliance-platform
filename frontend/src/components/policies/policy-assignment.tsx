"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, Laptop, Search, UserPlus, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDebounce } from "@/hooks/use-debounce";
import { useDepartments, useDeviceSearch } from "@/hooks/use-lookups";
import type { Device, DevicePolicy, Paginated } from "@/types/api";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ComplianceBadge } from "@/components/common/status-badges";
import { EmptyState, ErrorState } from "@/components/common/states";
import { OsIcon } from "@/components/common/os-icon";
import { ScoreRing } from "@/components/common/score-ring";
import { RelativeTime } from "@/components/common/misc";

function AssignDialog({ policy }: { policy: DevicePolicy }) {
  const [open, setOpen] = React.useState(false);
  const [deptIds, setDeptIds] = React.useState<string[]>([]);
  const [devices, setDevices] = React.useState<Record<string, string>>({});
  const [search, setSearch] = React.useState("");
  const debounced = useDebounce(search, 250);
  const departments = useDepartments(open);
  const results = useDeviceSearch(debounced, open);

  const resetState = () => {
    setDeptIds([]);
    setDevices({});
    setSearch("");
  };

  const assign = useApiMutation(
    (body: { deviceIds?: string[]; departmentIds?: string[] }) => api.post(`/policies/${policy.id}/assign`, body),
    {
      success: (_d, b) => {
        const parts: string[] = [];
        if (b.deviceIds?.length) parts.push(`${b.deviceIds.length} device${b.deviceIds.length === 1 ? "" : "s"}`);
        if (b.departmentIds?.length) parts.push(`${b.departmentIds.length} department${b.departmentIds.length === 1 ? "" : "s"}`);
        return `“${policy.name}” assigned to ${parts.join(" and ")}`;
      },
      invalidate: [["policies"], ["devices"], ["departments"], ["compliance"]],
      onSuccess: () => {
        setOpen(false);
        resetState();
      },
    },
  );

  const deviceIds = Object.keys(devices);
  const total = deviceIds.length + deptIds.length;

  const toggleDevice = (d: Device) =>
    setDevices((prev) => {
      const next = { ...prev };
      if (next[d.id]) delete next[d.id];
      else next[d.id] = d.deviceName;
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetState();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus /> Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assign “{policy.name}”</DialogTitle>
          <DialogDescription>
            Device assignments override department assignments. Affected devices receive an APPLY_POLICY command and are re-evaluated.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Building2 className="size-4 text-muted-foreground" /> Departments
          </p>
          {departments.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (departments.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No departments available.</p>
          ) : (
            <div className="grid max-h-44 gap-0.5 overflow-y-auto rounded-md border p-1.5 scrollbar-thin sm:grid-cols-2">
              {(departments.data ?? []).map((d) => {
                const checked = deptIds.includes(d.id);
                const current = d.policyId === policy.id;
                return (
                  <label key={d.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                    <Checkbox
                      checked={checked || current}
                      disabled={current}
                      onCheckedChange={(v) => setDeptIds((prev) => (v ? [...prev, d.id] : prev.filter((x) => x !== d.id)))}
                    />
                    <span className="truncate">{d.name}</span>
                    {current && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">assigned</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid min-w-0 gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Laptop className="size-4 text-muted-foreground" /> Devices
          </p>
          {deviceIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {deviceIds.map((id) => (
                <Badge key={id} tone="primary" className="gap-1 pr-0.5">
                  {devices[id]}
                  <button
                    type="button"
                    aria-label={`Remove ${devices[id]}`}
                    className="rounded-sm p-0.5 hover:bg-primary/20"
                    onClick={() =>
                      setDevices((prev) => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                      })
                    }
                  >
                    <X />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices by name, serial or user…"
              aria-label="Search devices"
              className="pl-8"
            />
          </div>
          <div className="max-h-52 overflow-y-auto rounded-md border scrollbar-thin">
            {results.isLoading ? (
              <div className="grid gap-2 p-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : results.isError ? (
              <ErrorState error={results.error} onRetry={() => results.refetch()} compact />
            ) : (results.data ?? []).length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">No devices found.</p>
            ) : (
              <ul className="divide-y">
                {(results.data ?? []).map((d) => {
                  const current = d.policyId === policy.id;
                  return (
                    <li key={d.id}>
                      <label className="flex min-w-0 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm hover:bg-accent">
                        <Checkbox checked={!!devices[d.id] || current} disabled={current} onCheckedChange={() => toggleDevice(d)} />
                        <OsIcon platform={d.platform} />
                        <span className="min-w-0 flex-1 truncate">
                          {d.deviceName}
                          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{d.serialNumber}</span>
                        </span>
                        {current ? (
                          <span className="shrink-0 text-[11px] text-muted-foreground">assigned</span>
                        ) : d.policy ? (
                          <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground sm:inline">{d.policy.name}</span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={total === 0}
            loading={assign.isPending}
            onClick={() =>
              assign.mutate({
                deviceIds: deviceIds.length ? deviceIds : undefined,
                departmentIds: deptIds.length ? deptIds : undefined,
              })
            }
          >
            Assign{total > 0 ? ` (${total})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PolicyAssignmentCard({ policy }: { policy: DevicePolicy }) {
  const { can } = useAuth();
  const canWrite = can("policies:write");
  const canOpenDevice = can("devices:read");
  const departments = useDepartments();
  const q = useQuery({
    queryKey: ["policies", "devices", policy.id],
    queryFn: async ({ signal }) => normalizeList(await api.get<Paginated<Device> | Device[]>(`/policies/${policy.id}/devices`, { pageSize: 200 }, { signal })),
  });
  const assignedDepts = (departments.data ?? []).filter((d) => d.policyId === policy.id);
  const total = q.data?.meta.total ?? q.data?.data.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <div className="grid min-w-0 gap-1">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" /> Assignment
          </CardTitle>
          <CardDescription>
            {policy.isDefault
              ? "Default policy — also applies to every device without a device- or department-level policy."
              : "Devices directly assigned to this policy."}
          </CardDescription>
        </div>
        {canWrite && (
          <CardAction>
            <AssignDialog policy={policy} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {assignedDepts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Departments:</span>
            {assignedDepts.map((d) => (
              <Badge key={d.id} tone="neutral">
                <Building2 /> {d.name}
              </Badge>
            ))}
          </div>
        )}
        {q.isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} compact />
        ) : (q.data?.data ?? []).length === 0 ? (
          <EmptyState icon={Laptop} title="No devices assigned" description="Assign devices or departments to roll this policy out." compact />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {total} device{total === 1 ? "" : "s"}
            </p>
            <ul className="max-h-96 divide-y overflow-y-auto rounded-md border scrollbar-thin">
              {(q.data?.data ?? []).map((d) => (
                <li key={d.id} className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
                  <OsIcon platform={d.platform} />
                  <div className="min-w-0 flex-1">
                    {canOpenDevice ? (
                      <Link href={`/devices/${d.id}`} className="block truncate font-medium hover:text-primary hover:underline">
                        {d.deviceName}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium">{d.deviceName}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {d.assignedUser?.displayName ?? "Unassigned"}
                      {d.department ? ` · ${d.department.name}` : ""}
                    </span>
                  </div>
                  <span className="hidden text-xs text-muted-foreground md:inline">
                    <RelativeTime value={d.lastSeenAt} />
                  </span>
                  <span className="hidden sm:inline-flex">
                    <ComplianceBadge value={d.complianceState} />
                  </span>
                  <ScoreRing score={d.complianceScore} size={28} />
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
