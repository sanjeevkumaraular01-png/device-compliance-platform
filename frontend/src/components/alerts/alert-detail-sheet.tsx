"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCheck, Send } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityBadge, StatusBadge } from "@/components/common/status-badges";
import { EmptyState, ErrorState } from "@/components/common/states";
import { KeyValueGrid, Mono, RelativeTime } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { alertStatusMeta, deliveryStatusMeta, toneDot, type Tone } from "@/lib/status";
import { formatDateTime, formatNumber, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelTypeIcon, channelTypeMeta } from "@/components/alerts/channel-meta";
import type { Alert } from "@/types/api";

function TimelineItem({ title, at, tone, done, last }: { title: string; at: string | null; tone: Tone; done: boolean; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className="absolute left-[5px] top-4 h-[calc(100%-0.75rem)] w-px bg-border" aria-hidden />}
      <span className={cn("mt-1 size-[11px] shrink-0 rounded-full ring-2 ring-background", done ? toneDot[tone] : "bg-muted-foreground/25")} aria-hidden />
      <div className="min-w-0">
        <div className={cn("text-sm", done ? "font-medium" : "text-muted-foreground")}>{title}</div>
        <div className="text-xs text-muted-foreground">{at ? formatDateTime(at) : "Pending"}</div>
      </div>
    </li>
  );
}

export function AlertDetailSheet({ alertId, onOpenChange }: { alertId: string | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const canWrite = can("alerts:write");
  const q = useQuery({
    queryKey: ["alerts", "detail", alertId],
    queryFn: () => api.get<Alert>(`/alerts/${alertId}`),
    enabled: !!alertId,
  });
  const a = q.data;

  const action = useApiMutation((v: { id: string; action: "acknowledge" | "resolve" }) => api.post<Alert>(`/alerts/${v.id}/${v.action}`), {
    success: (_d, v) => (v.action === "acknowledge" ? "Alert acknowledged" : "Alert resolved"),
    invalidate: [["alerts"], ["dashboard"]],
  });

  const metadataJson = React.useMemo(() => {
    if (!a?.metadata || (typeof a.metadata === "object" && Object.keys(a.metadata).length === 0)) return null;
    try {
      return JSON.stringify(a.metadata, null, 2);
    } catch {
      return String(a.metadata);
    }
  }, [a?.metadata]);

  return (
    <Sheet open={!!alertId} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          {a ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge value={a.severity} />
                <StatusBadge value={a.status} meta={alertStatusMeta} />
                <span className="text-xs text-muted-foreground">{humanize(a.category)}</span>
              </div>
              <SheetTitle className="break-words">{a.title}</SheetTitle>
              <SheetDescription className="sr-only">Alert details</SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle>Alert</SheetTitle>
              <SheetDescription className="sr-only">Loading alert details</SheetDescription>
            </>
          )}
        </SheetHeader>
        <SheetBody className="grid content-start gap-6">
          {q.isLoading ? (
            <div className="grid gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} compact />
          ) : a ? (
            <>
              <p className="whitespace-pre-wrap break-words text-sm">{a.message}</p>

              <KeyValueGrid
                items={[
                  {
                    label: "Endpoint",
                    value: a.deviceId ? (
                      <Link href={`/devices/${a.deviceId}`} className="font-medium hover:text-primary hover:underline">
                        {a.device?.deviceName ?? a.deviceId}
                      </Link>
                    ) : (
                      "Not device-specific"
                    ),
                  },
                  { label: "Category", value: humanize(a.category) },
                  { label: "Occurrences", value: formatNumber(a.occurrences) },
                  { label: "Last occurred", value: <RelativeTime value={a.lastOccurredAt} /> },
                  { label: "Rule", value: a.ruleKey, mono: true },
                  { label: "Dedupe key", value: a.dedupeKey, mono: true },
                  { label: "Alert ID", value: <Mono>{a.id}</Mono> },
                  { label: "Created", value: formatDateTime(a.createdAt) },
                ]}
              />

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
                <ol>
                  <TimelineItem title="Raised" at={a.createdAt} tone="critical" done />
                  <TimelineItem
                    title={a.acknowledgedAt ? "Acknowledged" : a.resolvedAt ? "Acknowledged (skipped)" : "Acknowledged"}
                    at={a.acknowledgedAt}
                    tone="medium"
                    done={!!a.acknowledgedAt}
                  />
                  <TimelineItem title="Resolved" at={a.resolvedAt} tone="success" done={!!a.resolvedAt} last />
                </ol>
              </section>

              {metadataJson && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metadata</h3>
                  <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed scrollbar-thin">{metadataJson}</pre>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notifications</h3>
                {(a.deliveries?.length ?? 0) === 0 ? (
                  <EmptyState compact icon={Send} title="No notifications sent" description="No enabled channel matched this alert's severity and category." className="rounded-md border" />
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Channel</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Attempts</TableHead>
                          <TableHead>Sent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {a.deliveries?.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="py-1.5">
                              <div className="flex items-center gap-2">
                                {d.channel && <ChannelTypeIcon type={d.channel.type} className="size-3.5 text-muted-foreground" />}
                                <div className="min-w-0">
                                  <div className="text-sm">{d.channel?.name ?? "Deleted channel"}</div>
                                  {d.channel && <div className="text-[11px] text-muted-foreground">{channelTypeMeta[d.channel.type]?.label}</div>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5">
                              <StatusBadge value={d.status} meta={deliveryStatusMeta} />
                              {d.error && (
                                <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-sev-critical" title={d.error}>
                                  {d.error}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-right tabular">{d.attempts}</TableCell>
                            <TableCell className="py-1.5 text-xs">{d.sentAt ? formatDateTime(d.sentAt) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </SheetBody>
        {a && canWrite && a.status !== "RESOLVED" && (
          <SheetFooter>
            {a.status === "OPEN" && (
              <Button variant="outline" onClick={() => action.mutate({ id: a.id, action: "acknowledge" })} loading={action.isPending && action.variables?.action === "acknowledge"} disabled={action.isPending}>
                <Check /> Acknowledge
              </Button>
            )}
            <Button onClick={() => action.mutate({ id: a.id, action: "resolve" })} loading={action.isPending && action.variables?.action === "resolve"} disabled={action.isPending}>
              <CheckCheck /> Resolve
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
