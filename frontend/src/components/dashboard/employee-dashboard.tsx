"use client";

import * as React from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ChevronRight, Laptop, LifeBuoy, Usb, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { normalizeList } from "@/hooks/use-list-query";
import { OsIcon } from "@/components/common/os-icon";
import { ScoreRing } from "@/components/common/score-ring";
import { ComplianceBadge, RiskBadge, SeverityBadge } from "@/components/common/status-badges";
import { OnlineDot, RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UsbRequestDialog } from "@/components/usb/usb-request-dialog";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { platformLabel } from "@/lib/format";
import { RISK_ORDER } from "@/lib/status";
import type { ComplianceFinding, Device, DeviceDetail, Paginated } from "@/types/api";

const MAX_DETAIL_FETCH = 10;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function DeviceCard({ device }: { device: Device }) {
  return (
    <Link
      href={`/devices/${device.id}`}
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-primary/40 group-hover:bg-accent/30">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/40">
            <OsIcon platform={device.platform} className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold">{device.deviceName}</p>
              <OnlineDot online={device.online} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {[platformLabel[device.platform], device.osVersion, device.model].filter(Boolean).join(" · ")}
            </p>
          </div>
          <ScoreRing score={device.complianceScore} size={42} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ComplianceBadge value={device.complianceState} />
          <RiskBadge value={device.riskLevel} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5 text-xs text-muted-foreground">
          <span>
            Last seen <RelativeTime value={device.lastSeenAt} />
          </span>
          <span className="inline-flex items-center gap-0.5 font-medium text-primary">
            Details <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

interface FixItem extends ComplianceFinding {
  deviceId: string;
  deviceName: string;
}

function FixList({ devices }: { devices: Device[] }) {
  const targets = devices.slice(0, MAX_DETAIL_FETCH);
  const details = useQueries({
    queries: targets.map((d) => ({
      queryKey: ["devices", "dashboard-detail", d.id],
      queryFn: () => api.get<DeviceDetail>(`/devices/${d.id}`),
      staleTime: 60_000,
    })),
  });

  const loading = details.some((q) => q.isLoading);
  const failed = details.filter((q) => q.isError);
  const items: FixItem[] = [];
  for (const q of details) {
    const d = q.data;
    if (!d?.latestCompliance) continue;
    for (const f of d.latestCompliance.findings ?? []) {
      if (!f.passed) items.push({ ...f, deviceId: d.id, deviceName: d.deviceName });
    }
  }
  items.sort((a, b) => RISK_ORDER.indexOf(a.severity) - RISK_ORDER.indexOf(b.severity));
  const evaluated = details.some((q) => q.data?.latestCompliance);
  const multi = targets.length > 1;

  return (
    <WidgetCard icon={Wrench} title="What you need to fix" description="Issues found during the latest compliance check of your devices">
      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : failed.length > 0 && items.length === 0 ? (
        <ErrorState compact error={failed[0].error} onRetry={() => failed.forEach((q) => q.refetch())} />
      ) : !evaluated ? (
        <EmptyState compact title="Not evaluated yet" description="Your devices will be checked automatically after the agent reports in." />
      ) : items.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="You're all set" description="Your devices pass every compliance check. Nice work!" />
      ) : (
        <ul className="grid gap-2">
          {items.map((f) => (
            <li key={`${f.deviceId}-${f.ruleKey}`} className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge value={f.severity} />
                <span className="min-w-0 flex-1 text-sm font-medium">{f.name}</span>
                {multi && (
                  <Link href={`/devices/${f.deviceId}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                    {f.deviceName}
                  </Link>
                )}
              </div>
              {f.remediation && (
                <p className="mt-1.5 flex gap-1.5 text-xs text-muted-foreground">
                  <ArrowRight className="mt-0.5 size-3 shrink-0" />
                  <span>{f.remediation}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export function EmployeeDashboard() {
  const { user, can } = useAuth();
  const firstName = user?.displayName?.split(" ")[0] ?? "there";
  const devicesQ = useQuery({
    queryKey: ["devices", "mine"],
    queryFn: async () =>
      normalizeList(await api.get<Paginated<Device> | Device[]>("/devices", { pageSize: 50, sortBy: "lastSeenAt", sortOrder: "desc" })).data,
    refetchInterval: 60_000,
  });
  const devices = devicesQ.data ?? [];
  const nonCompliant = devices.filter((d) => d.complianceState === "NON_COMPLIANT").length;

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {devicesQ.isLoading
            ? "Checking on your devices…"
            : devices.length === 0
              ? "Here is an overview of your work devices."
              : nonCompliant > 0
                ? devices.length === 1
                  ? "Your device needs attention — see what to fix below."
                  : `${nonCompliant} of your ${devices.length} devices ${nonCompliant === 1 ? "needs" : "need"} attention — see what to fix below.`
                : devices.length === 1
                  ? "Your device is in good shape."
                  : `All ${devices.length} of your devices are in good shape.`}
        </p>
      </div>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Laptop className="size-4 text-muted-foreground" /> My devices
          </h2>
          {devices.length > 0 && can("devices:read") && (
            <Button asChild variant="ghost" size="xs" className="text-muted-foreground">
              <Link href="/devices">
                View all <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
        {devicesQ.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-[150px] w-full rounded-lg" />
            ))}
          </div>
        ) : devicesQ.isError ? (
          <Card>
            <ErrorState compact error={devicesQ.error} onRetry={() => devicesQ.refetch()} />
          </Card>
        ) : devices.length === 0 ? (
          <Card>
            <EmptyState
              icon={Laptop}
              title="No devices assigned to you"
              description="Once IT assigns a company device to you, its health and compliance status will show up here."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} />
            ))}
          </div>
        )}
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {devices.length > 0 ? (
            <FixList devices={devices} />
          ) : (
            <WidgetCard icon={Wrench} title="What you need to fix">
              <EmptyState compact title="Nothing to fix" description="No devices to check yet." />
            </WidgetCard>
          )}
        </div>
        <div className="grid min-w-0 content-start gap-4">
          {can("usb:request") && (
            <WidgetCard icon={Usb} title="Need a USB device?" description="USB storage is restricted by company policy">
              <p className="mb-3 text-sm text-muted-foreground">
                Request temporary access for a specific USB drive. Your manager or IT will review the request.
              </p>
              <div className="flex flex-wrap gap-2">
                <UsbRequestDialog
                  trigger={
                    <Button size="sm">
                      <Usb /> Request USB access
                    </Button>
                  }
                />
                <Button asChild variant="outline" size="sm">
                  <Link href="/usb">My requests</Link>
                </Button>
              </div>
            </WidgetCard>
          )}
          <WidgetCard icon={LifeBuoy} title="Need help?">
            <p className="text-sm text-muted-foreground">
              Keep your device online and connected so the security agent can report its status. If a check keeps failing after you
              follow the steps, contact your IT help desk.
            </p>
          </WidgetCard>
        </div>
      </div>
    </div>
  );
}
