"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Trash2 } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/common/status-badges";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { OsIcon } from "@/components/common/os-icon";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { normalizeList } from "@/hooks/use-list-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { softwareStatusMeta } from "@/lib/status";
import type { OsPlatform, Paginated, SoftwareAggregate, SoftwareStatus } from "@/types/api";

/**
 * Row returned by GET /software/inventory/:name/devices. API.md only says "devices that have it", so accept either
 * device rows ({id, deviceName, …}) or inventory rows ({deviceId, version, device: {id, deviceName}}).
 */
interface InstalledOnRow {
  id: string;
  deviceId?: string;
  deviceName?: string;
  platform?: OsPlatform;
  version?: string;
  status?: SoftwareStatus;
  lastSeenAt?: string | null;
  firstSeenAt?: string | null;
  device?: { id: string; deviceName: string; platform?: OsPlatform } | null;
}

function resolve(r: InstalledOnRow) {
  const id = r.device?.id ?? r.deviceId ?? r.id;
  return {
    key: `${id}-${r.version ?? ""}-${r.id}`,
    id,
    name: r.device?.deviceName ?? r.deviceName ?? id,
    platform: r.device?.platform ?? r.platform,
    version: r.version,
    status: r.status,
    seen: r.lastSeenAt ?? r.firstSeenAt ?? null,
  };
}

export const uninstallSuccess = (res: { commands?: number } | undefined, fallback: number) => {
  const n = typeof res?.commands === "number" ? res.commands : fallback;
  return `Queued ${formatNumber(n)} uninstall command${n === 1 ? "" : "s"}`;
};

export function InventoryDevicesSheet({ item, onOpenChange }: { item: SoftwareAggregate | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const name = item?.name ?? "";
  const q = useQuery({
    queryKey: ["software", "inventory-devices", name],
    queryFn: async () =>
      normalizeList(await api.get<Paginated<InstalledOnRow> | InstalledOnRow[]>(`/software/inventory/${encodeURIComponent(name)}/devices`, { pageSize: 200 })).data,
    enabled: !!item,
  });
  const rows = React.useMemo(() => (q.data ?? []).map(resolve), [q.data]);
  const deviceIds = React.useMemo(() => Array.from(new Set(rows.map((r) => r.id))), [rows]);
  const showVersion = rows.some((r) => r.version);
  const showStatus = rows.some((r) => r.status);

  const uninstall = useApiMutation((v: { deviceIds: string[]; name: string }) => api.post<{ commands: number }>("/software/uninstall", v), {
    success: (res, v) => uninstallSuccess(res, v.deviceIds.length),
    invalidate: [["software"], ["devices"]],
  });

  const onUninstallAll = async () => {
    if (!item || deviceIds.length === 0) return;
    const ok = await confirm({
      title: `Uninstall "${item.name}" from ${deviceIds.length} endpoint${deviceIds.length === 1 ? "" : "s"}?`,
      description: "An UNINSTALL_SOFTWARE command is queued for every endpoint below. Agents run it on their next check-in; this cannot be undone from the console.",
      confirmLabel: "Queue uninstall",
      destructive: true,
      typeToConfirm: deviceIds.length > 10 ? "UNINSTALL" : undefined,
    });
    if (ok) uninstall.mutate({ deviceIds, name: item.name });
  };

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="min-w-0 break-words">{item?.name}</SheetTitle>
            {item && <StatusBadge value={item.status} meta={softwareStatusMeta} />}
          </div>
          <SheetDescription>
            {item?.publisher || "Unknown publisher"} · installed on {formatNumber(item?.installCount)} endpoint{item?.installCount === 1 ? "" : "s"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {q.isLoading ? (
            <TableSkeleton rows={6} cols={3} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} compact />
          ) : rows.length === 0 ? (
            <EmptyState compact icon={Monitor} title="No endpoints report this software" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Endpoint</TableHead>
                    {showVersion && <TableHead>Version</TableHead>}
                    {showStatus && <TableHead>Status</TableHead>}
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-2">
                          {r.platform && <OsIcon platform={r.platform} />}
                          <Link href={`/devices/${r.id}`} className="font-medium hover:text-primary hover:underline">
                            {r.name}
                          </Link>
                        </div>
                      </TableCell>
                      {showVersion && <TableCell className="py-1.5 font-mono text-xs">{r.version ?? "—"}</TableCell>}
                      {showStatus && (
                        <TableCell className="py-1.5">
                          <StatusBadge value={r.status} meta={softwareStatusMeta} />
                        </TableCell>
                      )}
                      <TableCell className="py-1.5">
                        <RelativeTime value={r.seen} fallback="—" className="text-xs" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SheetBody>
        {can("software:write") && deviceIds.length > 0 && (
          <SheetFooter>
            <Button variant="destructive" onClick={onUninstallAll} loading={uninstall.isPending}>
              <Trash2 /> Uninstall from all ({deviceIds.length})
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
