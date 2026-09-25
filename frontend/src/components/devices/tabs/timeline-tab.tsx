"use client";

import { useQuery } from "@tanstack/react-query";
import { Cog, KeyRound, Laptop, Package, ScrollText, ShieldCheck, Usb, UserRound, History, CircleX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { formatDateTimeSeconds, humanize } from "@/lib/format";
import { toneBadge, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { AuditCategory, AuditLog, Paginated } from "@/types/api";

const categoryMeta: Record<AuditCategory, { icon: React.ComponentType<{ className?: string }>; tone: Tone }> = {
  USER_ACTION: { icon: UserRound, tone: "primary" },
  DEVICE_CHANGE: { icon: Laptop, tone: "info" },
  POLICY_CHANGE: { icon: ScrollText, tone: "low" },
  AUTH: { icon: KeyRound, tone: "neutral" },
  USB: { icon: Usb, tone: "medium" },
  SOFTWARE: { icon: Package, tone: "info" },
  SECURITY: { icon: ShieldCheck, tone: "high" },
  SYSTEM: { icon: Cog, tone: "neutral" },
};

/** "device.command.created" → "Device command created" */
function actionLabel(action: string): string {
  return humanize(action);
}

export function TimelineTab({ deviceId }: { deviceId: string }) {
  const q = useQuery({
    queryKey: ["devices", deviceId, "timeline"],
    queryFn: async () => normalizeList(await api.get<Paginated<AuditLog> | AuditLog[]>(`/devices/${deviceId}/timeline`, { pageSize: 100 })).data,
  });

  if (q.isLoading) {
    return (
      <Card>
        <TableSkeleton rows={6} cols={3} />
      </Card>
    );
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const entries = [...(q.data ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState icon={History} title="No activity yet" description="Changes, commands and security events for this device will appear here." />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <ol className="relative">
          {entries.map((e, i) => {
            const meta = categoryMeta[e.category] ?? { icon: Cog, tone: "neutral" as Tone };
            const Icon = meta.icon;
            const last = i === entries.length - 1;
            return (
              <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" aria-hidden />}
                <span className={cn("relative z-[1] grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset", toneBadge[e.success ? meta.tone : "critical"])}>
                  {e.success ? <Icon className="size-3.5" /> : <CircleX className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">{actionLabel(e.action)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {humanize(e.category)}
                    </Badge>
                    {!e.success && <Badge tone="critical">Failed</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground" title={formatDateTimeSeconds(e.occurredAt)}>
                      <RelativeTime value={e.occurredAt} />
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    by <span className="text-foreground">{e.actorName ?? humanize(e.actorType)}</span>
                    {e.actorType !== "USER" && e.actorName ? ` (${humanize(e.actorType)})` : ""}
                    {e.ipAddress ? ` · ${e.ipAddress}` : ""}
                    <span className="ml-1 font-mono text-[10px]">{e.action}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
