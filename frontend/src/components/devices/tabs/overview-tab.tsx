"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Cpu, History, Network, RadioTower, StickyNote, Tag } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplianceBadge, StatusBadge } from "@/components/common/status-badges";
import { CopyButton, KeyValueGrid, OnlineDot, RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { OsIcon } from "@/components/common/os-icon";
import { normalizeList } from "@/hooks/use-list-query";
import { usePermission } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatRam, formatStorage, humanize } from "@/lib/format";
import { warrantyMeta } from "@/lib/status";
import { initials } from "@/lib/utils";
import type { DeviceAssignment, DeviceDetail, Paginated } from "@/types/api";

function SectionIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <Icon className="size-4 text-muted-foreground" />;
}

export function OverviewTab({ device }: { device: DeviceDetail }) {
  const canPolicies = usePermission("policies:read");
  const osVersion = [device.osName, device.osVersion, device.osBuild ? `(build ${device.osBuild})` : null].filter(Boolean).join(" ");

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={Cpu} />
          <CardTitle>Hardware inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            cols={3}
            items={[
              { label: "Device Name", value: device.deviceName },
              {
                label: "Serial Number",
                value: (
                  <span className="inline-flex items-center gap-1">
                    <span className="truncate font-mono text-xs">{device.serialNumber}</span>
                    <CopyButton value={device.serialNumber} label="Copy serial number" />
                  </span>
                ),
              },
              { label: "Asset ID", value: device.assetId, mono: true },
              { label: "Device Type", value: humanize(device.deviceType) },
              { label: "Manufacturer", value: device.manufacturer },
              { label: "Model", value: device.model },
              { label: "CPU", value: device.cpu ? <span title={device.cpu}>{device.cpu}</span> : null },
              { label: "RAM", value: formatRam(device.ramMb) },
              { label: "Storage", value: formatStorage(device.storageGb) },
              {
                label: "OS Version",
                value: osVersion ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5" title={osVersion}>
                    <OsIcon platform={device.platform} />
                    <span className="truncate">{osVersion}</span>
                  </span>
                ) : null,
              },
              {
                label: "Assigned User",
                value: device.assignedUser ? (
                  <span title={device.assignedUser.email}>{device.assignedUser.displayName}</span>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                ),
              },
              { label: "Department", value: device.department?.name },
              { label: "Purchase Date", value: device.purchaseDate ? formatDate(device.purchaseDate) : null },
              {
                label: "Warranty Status",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <StatusBadge value={device.warrantyStatus} meta={warrantyMeta} />
                    {device.warrantyExpiresAt && <span className="text-xs text-muted-foreground">until {formatDate(device.warrantyExpiresAt)}</span>}
                  </span>
                ),
              },
              {
                label: "Compliance Status",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <ComplianceBadge value={device.complianceState} />
                    {device.complianceState !== "UNKNOWN" && <span className="text-xs tabular text-muted-foreground">score {device.complianceScore}</span>}
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <SectionIcon icon={RadioTower} />
            <CardTitle>Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValueGrid
              items={[
                { label: "Agent version", value: device.agentVersion, mono: true },
                {
                  label: "Last seen",
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <OnlineDot online={device.online} />
                      <RelativeTime value={device.lastSeenAt} />
                    </span>
                  ),
                },
                { label: "Enrolled", value: device.enrolledAt ? formatDate(device.enrolledAt) : <span className="text-muted-foreground">Not enrolled</span> },
                { label: "Last evaluated", value: <RelativeTime value={device.lastEvaluatedAt} /> },
                {
                  label: "Policy",
                  value: device.policy ? (
                    canPolicies ? (
                      <Link href={`/policies/${device.policy.id}`} className="text-primary hover:underline">
                        {device.policy.name}
                      </Link>
                    ) : (
                      device.policy.name
                    )
                  ) : (
                    <span className="text-muted-foreground">Inherited (department / default)</span>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <SectionIcon icon={Network} />
            <CardTitle>Network</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValueGrid
              cols={2}
              items={[
                { label: "Hostname", value: device.hostname, mono: true },
                { label: "IP address", value: device.ipAddress, mono: true },
              ]}
            />
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">MAC addresses</p>
              {device.macAddresses?.length ? (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {device.macAddresses.map((m) => (
                    <li key={m}>
                      <Badge variant="outline" className="font-mono">
                        {m}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">—</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <AssignmentHistory deviceId={device.id} className="xl:col-span-2" />

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={Tag} />
          <CardTitle>Tags &amp; notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {device.tags?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {device.tags.map((t) => (
                <Badge key={t} tone="primary">
                  {t}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No tags.</p>
          )}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <StickyNote className="size-3" /> Notes
            </p>
            {device.notes ? <p className="whitespace-pre-wrap break-words text-sm">{device.notes}</p> : <p className="text-xs text-muted-foreground">No notes.</p>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {device.isCompanyOwned ? "Company-owned" : "Personal (BYOD)"} · created {formatDate(device.createdAt)} · updated {formatDateTime(device.updatedAt)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AssignmentHistory({ deviceId, className }: { deviceId: string; className?: string }) {
  const q = useQuery({
    queryKey: ["devices", deviceId, "assignments"],
    queryFn: async () =>
      normalizeList(await api.get<Paginated<DeviceAssignment> | DeviceAssignment[]>(`/devices/${deviceId}/assignments`)).data,
  });

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center gap-2">
        <SectionIcon icon={History} />
        <div>
          <CardTitle>Assignment history</CardTitle>
          <CardDescription className="mt-1">Who has had this device, and when.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} compact />
        ) : !q.data?.length ? (
          <EmptyState compact title="Never assigned" description="Assign a user to start the custody history." />
        ) : (
          <ol className="divide-y">
            {[...q.data]
              .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
              .map((a) => {
                const current = !a.unassignedAt;
                const name = a.user?.displayName ?? a.userId;
                return (
                  <li key={a.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {initials(a.user?.displayName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{name}</span>
                        {current && <Badge tone="success">Current</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(a.assignedAt)} → {a.unassignedAt ? formatDate(a.unassignedAt) : "present"}
                        {a.assignedBy?.displayName ? ` · by ${a.assignedBy.displayName}` : ""}
                      </p>
                      {a.notes && <p className="mt-0.5 break-words text-xs">{a.notes}</p>}
                    </div>
                    {a.user?.email && <span className="hidden truncate text-xs text-muted-foreground sm:block">{a.user.email}</span>}
                  </li>
                );
              })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
