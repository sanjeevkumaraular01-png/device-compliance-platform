"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { SeverityBadge } from "@/components/common/status-badges";
import { EmptyState, ErrorState, CardSkeleton } from "@/components/common/states";
import { SectionTitle } from "@/components/common/page-header";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelTypeIcon, channelDestination, channelTypeMeta } from "@/components/alerts/channel-meta";
import { ChannelDialog } from "@/components/alerts/channel-dialog";
import { ALERT_CATEGORIES, type AlertChannel, type Paginated } from "@/types/api";

function ChannelCard({
  channel,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  toggling,
  testing,
}: {
  channel: AlertChannel;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  toggling: boolean;
  testing: boolean;
}) {
  const allCategories = channel.categories.length === 0 || channel.categories.length === ALERT_CATEGORIES.length;
  const destination = channelDestination(channel.type, channel.config);
  return (
    <Card className={cn("flex min-w-0 flex-col", !channel.enabled && "opacity-75")}>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-md ring-1 ring-inset", channel.enabled ? "bg-primary/10 text-primary ring-primary/20" : "bg-muted text-muted-foreground ring-border")}>
            <ChannelTypeIcon type={channel.type} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium" title={channel.name}>
              {channel.name}
            </div>
            <div className="text-xs text-muted-foreground">{channelTypeMeta[channel.type]?.label ?? humanize(channel.type)}</div>
          </div>
          <Switch checked={channel.enabled} onCheckedChange={onToggle} disabled={toggling} aria-label={`${channel.enabled ? "Disable" : "Enable"} ${channel.name}`} />
        </div>

        {destination && (
          <div className="truncate rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground" title={destination}>
            {destination}
          </div>
        )}

        <div className="grid gap-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">Min severity</span>
            <SeverityBadge value={channel.minSeverity} />
            <span className="text-muted-foreground">and above</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-20 shrink-0 pt-0.5 text-muted-foreground">Categories</span>
            <div className="flex min-w-0 flex-wrap gap-1">
              {allCategories ? (
                <Badge variant="outline">All categories</Badge>
              ) : (
                channel.categories.map((c) => (
                  <Badge key={c} variant="secondary">
                    {humanize(c)}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-1 border-t pt-3">
          <Button variant="outline" size="xs" onClick={onTest} loading={testing}>
            <Send /> Send test
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <SimpleTooltip label="Edit">
              <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`Edit ${channel.name}`}>
                <Pencil />
              </Button>
            </SimpleTooltip>
            <SimpleTooltip label="Delete">
              <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" onClick={onDelete} aria-label={`Delete ${channel.name}`}>
                <Trash2 />
              </Button>
            </SimpleTooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChannelsTab() {
  const confirm = useConfirm();
  const q = useQuery({
    queryKey: ["alerts", "channels"],
    queryFn: async () => normalizeList(await api.get<Paginated<AlertChannel> | AlertChannel[]>("/alerts/channels")).data,
  });
  const [dialog, setDialog] = React.useState<{ open: boolean; channel: AlertChannel | null }>({ open: false, channel: null });

  const toggle = useApiMutation((v: { id: string; enabled: boolean }) => api.patch<AlertChannel>(`/alerts/channels/${v.id}`, { enabled: v.enabled }), {
    success: (_d, v) => (v.enabled ? "Channel enabled" : "Channel disabled"),
    invalidate: [["alerts", "channels"]],
  });
  const test = useApiMutation((c: AlertChannel) => api.post(`/alerts/channels/${c.id}/test`), {
    success: (_d, c) => `Test message sent to "${c.name}"`,
    errorTitle: "Test message failed",
  });
  const remove = useApiMutation((c: AlertChannel) => api.delete(`/alerts/channels/${c.id}`), {
    success: "Channel deleted",
    invalidate: [["alerts", "channels"]],
  });

  const onDelete = async (c: AlertChannel) => {
    const ok = await confirm({
      title: `Delete channel "${c.name}"?`,
      description: "Alerts will no longer be delivered to this destination. Delivery history on existing alerts is kept.",
      confirmLabel: "Delete channel",
      destructive: true,
    });
    if (ok) remove.mutate(c);
  };

  const channels = q.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Notification channels"
        description="Where alerts are delivered. Each channel filters by minimum severity and category."
        actions={
          <Button size="sm" onClick={() => setDialog({ open: true, channel: null })}>
            <Plus /> Add channel
          </Button>
        }
      />
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} className="h-44" />
          ))}
        </div>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} compact />
        </Card>
      ) : channels.length === 0 ? (
        <Card>
          <EmptyState
            icon={BellRing}
            title="No notification channels"
            description="Add email, SMS, WhatsApp, Slack, Teams or webhook destinations to be notified when alerts fire."
            action={
              <Button size="sm" onClick={() => setDialog({ open: true, channel: null })}>
                <Plus /> Add channel
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {channels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              onEdit={() => setDialog({ open: true, channel: c })}
              onDelete={() => onDelete(c)}
              onToggle={(enabled) => toggle.mutate({ id: c.id, enabled })}
              onTest={() => test.mutate(c)}
              toggling={toggle.isPending && toggle.variables?.id === c.id}
              testing={test.isPending && test.variables?.id === c.id}
            />
          ))}
        </div>
      )}
      <ChannelDialog open={dialog.open} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} channel={dialog.channel} />
    </div>
  );
}
