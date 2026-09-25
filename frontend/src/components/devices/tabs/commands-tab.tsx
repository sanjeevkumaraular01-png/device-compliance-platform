"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, SquareTerminal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { commandStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DeviceCommand, Paginated } from "@/types/api";
import { commandLabel } from "@/components/devices/device-commands";

const ACTIVE = new Set(["PENDING", "SENT"]);

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed scrollbar-thin">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function resultError(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const e = result.error;
  return typeof e === "string" && e ? e : null;
}

export function CommandsTab({ deviceId }: { deviceId: string }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ["devices", deviceId, "commands"],
    queryFn: async () =>
      normalizeList(await api.get<Paginated<DeviceCommand> | DeviceCommand[]>(`/devices/${deviceId}/commands`, { pageSize: 100, sortBy: "createdAt", sortOrder: "desc" })).data,
    refetchInterval: (query) => ((query.state.data ?? []).some((c) => ACTIVE.has(c.status)) ? 10_000 : false),
  });

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (q.isLoading) {
    return (
      <Card>
        <TableSkeleton rows={5} cols={6} />
      </Card>
    );
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = [...(q.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={SquareTerminal} title="No commands yet" description="Remote actions queued for this device (inventory, patching, restart…) appear here." />
      </Card>
    );
  }
  const anyActive = rows.some((c) => ACTIVE.has(c.status));

  return (
    <Card className="overflow-hidden">
      {anyActive && (
        <div className="border-b bg-info/8 px-3 py-1.5 text-xs text-muted-foreground">
          Commands are delivered on the agent&apos;s next check-in. This list refreshes every 10 seconds while commands are pending.
        </div>
      )}
      <Table containerStyle={{ maxHeight: "max(22rem, calc(100dvh - 22rem))" }}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead>Command</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Expires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const open = expanded.has(c.id);
            const err = resultError(c.result);
            return (
              <React.Fragment key={c.id}>
                <TableRow className={cn("cursor-pointer", open && "bg-muted/30")} onClick={() => toggle(c.id)}>
                  <TableCell className="py-1.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={open ? "Collapse details" : "Expand details"}
                      aria-expanded={open}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(c.id);
                      }}
                    >
                      <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
                    </Button>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="font-medium">{commandLabel(c.type)}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{c.type}</div>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge value={c.status} meta={commandStatusMeta} />
                      {err && <span className="max-w-[200px] truncate text-xs text-sev-critical" title={err}>{err}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5 text-xs" title={formatDateTime(c.createdAt)}>
                    <RelativeTime value={c.createdAt} />
                  </TableCell>
                  <TableCell className="py-1.5 text-xs">
                    <RelativeTime value={c.sentAt} fallback="—" />
                  </TableCell>
                  <TableCell className="py-1.5 text-xs">
                    <RelativeTime value={c.completedAt} fallback="—" />
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-1.5 text-xs text-muted-foreground">{formatDateTime(c.expiresAt)}</TableCell>
                </TableRow>
                {open && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="bg-muted/20 px-4 py-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="min-w-0">
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payload</p>
                          <Json value={c.payload ?? {}} />
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Result</p>
                          {c.result ? <Json value={c.result} /> : <p className="text-xs text-muted-foreground">No result reported yet.</p>}
                        </div>
                      </div>
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">id {c.id}</p>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
