"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Monitor, MonitorSmartphone, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { UserSession } from "@/types/api";
import { parseUserAgent } from "@/components/settings/net-utils";

export function useSessions() {
  return useQuery({
    queryKey: ["settings", "sessions"],
    queryFn: ({ signal }) => api.get<UserSession[]>("/auth/sessions", undefined, { signal }),
  });
}

export function SessionsTab() {
  const confirm = useConfirm();
  const sessions = useSessions();
  const list = React.useMemo(
    () => [...(sessions.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt)),
    [sessions.data],
  );
  const others = list.filter((s) => !s.current);

  const revoke = useApiMutation((s: UserSession) => api.delete(`/auth/sessions/${s.id}`), {
    success: "Session revoked",
    invalidate: [["settings", "sessions"]],
  });
  const revokeOthers = useApiMutation(() => api.delete("/auth/sessions"), {
    success: "Signed out of all other sessions",
    invalidate: [["settings", "sessions"]],
  });

  const onRevoke = async (s: UserSession) => {
    const ua = parseUserAgent(s.userAgent);
    if (
      await confirm({
        title: "Revoke this session?",
        description: `${ua.browser} on ${ua.os}${s.ipAddress ? ` (${s.ipAddress})` : ""} will be signed out immediately.`,
        confirmLabel: "Revoke",
        destructive: true,
      })
    ) {
      revoke.mutate(s);
    }
  };

  const onRevokeOthers = async () => {
    if (
      await confirm({
        title: "Sign out all other sessions?",
        description: `${others.length} other session${others.length === 1 ? "" : "s"} will be signed out. This device stays signed in.`,
        confirmLabel: "Sign out others",
        destructive: true,
      })
    ) {
      revokeOthers.mutate();
    }
  };

  return (
    <Card className="max-w-4xl">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account. Revoke any session you do not recognise and change your password.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onRevokeOthers} disabled={others.length === 0} loading={revokeOthers.isPending} className="shrink-0">
          {!revokeOthers.isPending && <LogOut />} Sign out all other sessions
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {sessions.isLoading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} compact />
        ) : list.length === 0 ? (
          <EmptyState icon={MonitorSmartphone} title="No active sessions" compact />
        ) : (
          <ul className="divide-y border-t">
            {list.map((s) => {
              const ua = parseUserAgent(s.userAgent);
              const Icon = ua.mobile ? Smartphone : Monitor;
              return (
                <li key={s.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {ua.browser} on {ua.os}
                        {s.current && <Badge tone="success" dot>This device</Badge>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{s.ipAddress ?? "Unknown IP"}</span>
                        <span>
                          Last active <RelativeTime value={s.lastSeenAt} />
                        </span>
                        <span>Signed in {formatDateTime(s.createdAt)}</span>
                        <span>Expires {formatDateTime(s.expiresAt)}</span>
                      </p>
                      {s.userAgent && (
                        <SimpleTooltip label={<span className="break-all">{s.userAgent}</span>}>
                          <p tabIndex={0} className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                            {s.userAgent}
                          </p>
                        </SimpleTooltip>
                      )}
                    </div>
                  </div>
                  {!s.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-end text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-center"
                      onClick={() => onRevoke(s)}
                      disabled={revoke.isPending && revoke.variables?.id === s.id}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
