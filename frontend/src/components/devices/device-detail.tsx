"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Laptop, Package, PackageX, ShieldAlert, Usb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComplianceBadge, RiskBadge, StatusBadge } from "@/components/common/status-badges";
import { ScoreRing } from "@/components/common/score-ring";
import { OsIcon } from "@/components/common/os-icon";
import { CopyButton, OnlineDot, RelativeTime } from "@/components/common/misc";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { useAuth } from "@/lib/auth";
import { ApiError, api } from "@/lib/api";
import { formatDate, humanize, platformLabel } from "@/lib/format";
import { deviceStatusMeta, toneBadge, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DeviceDetail as DeviceDetailT, PatchState } from "@/types/api";
import { DeviceActions } from "@/components/devices/device-actions";
import { OverviewTab } from "@/components/devices/tabs/overview-tab";
import { SecurityTab } from "@/components/devices/tabs/security-tab";
import { ComplianceTab } from "@/components/devices/tabs/compliance-tab";
import { SoftwareTab } from "@/components/devices/tabs/software-tab";
import { PatchesTab } from "@/components/devices/tabs/patches-tab";
import { UsbEventsTab } from "@/components/devices/tabs/usb-tab";
import { CommandsTab } from "@/components/devices/tabs/commands-tab";
import { TimelineTab } from "@/components/devices/tabs/timeline-tab";

const TABS = ["overview", "security", "compliance", "software", "patches", "usb", "commands", "timeline"] as const;
type TabKey = (typeof TABS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  security: "Security",
  compliance: "Compliance",
  software: "Software",
  patches: "Patches",
  usb: "USB Events",
  commands: "Commands",
  timeline: "Timeline",
};

export function DeviceDetail({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAuth();

  const q = useQuery({
    queryKey: ["devices", id, "detail"],
    queryFn: () => api.get<DeviceDetailT>(`/devices/${id}`),
    retry: (count, err) => !(err instanceof ApiError && (err.isNotFound || err.isForbidden || err.isNetwork)) && count < 2,
  });
  const device = q.data;
  useBreadcrumbLabel(device?.deviceName);

  const rawTab = searchParams.get("tab");
  const tab: TabKey = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as TabKey) : "overview";
  // Patches filter preset when arriving from the "missing patches" chip.
  const [patchPreset, setPatchPreset] = React.useState<PatchState | undefined>(undefined);

  const setTab = React.useCallback(
    (next: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "overview") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Every sub-resource only needs devices:read (already required for this route); actions inside are gated individually.
  const visibleTabs = TABS;

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError && !device) {
    if (q.error instanceof ApiError && q.error.isNotFound) {
      return (
        <Card>
          <EmptyState
            icon={Laptop}
            title="Device not found"
            description="This device does not exist, was permanently deleted, or is outside your scope."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/devices">
                  <ArrowLeft /> Back to devices
                </Link>
              </Button>
            }
          />
        </Card>
      );
    }
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!device) return <DetailSkeleton />;

  const counts = device.counts ?? { software: 0, unauthorizedSoftware: 0, missingPatches: 0, usbBlocked7d: 0, openAlerts: 0 };

  return (
    <div className="grid min-w-0 gap-4">
      {device.status === "QUARANTINED" && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-sev-critical/30 bg-sev-critical/8 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-sev-critical" />
          <span>
            <span className="font-medium">This device is quarantined.</span> <span className="text-muted-foreground">It is isolated until an administrator releases it.</span>
          </span>
        </div>
      )}
      {device.status === "RETIRED" && (
        <div role="status" className="flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          This device is retired. Its agent credentials are revoked and it no longer reports.
        </div>
      )}

      {/* Header */}
      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 gap-3">
            <span className="hidden size-12 shrink-0 place-items-center rounded-lg border bg-muted/40 sm:grid">
              <OsIcon platform={device.platform} className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="sm:hidden">
                  <OsIcon platform={device.platform} />
                </span>
                <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight sm:text-xl">{device.deviceName}</h1>
                <StatusBadge value={device.status} meta={deviceStatusMeta} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {device.hostname && <span className="font-mono">{device.hostname}</span>}
                <span className="inline-flex items-center gap-0.5">
                  <span className="font-mono">SN {device.serialNumber}</span>
                  <CopyButton value={device.serialNumber} label="Copy serial number" />
                </span>
                {device.assetId && <span className="font-mono">Asset {device.assetId}</span>}
                <span>
                  {platformLabel[device.platform]} · {humanize(device.deviceType)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <OnlineDot online={device.online} withLabel />
                  <span>· last seen</span>
                  <RelativeTime value={device.lastSeenAt} className="text-foreground" />
                </span>
                <span>Enrolled {device.enrolledAt ? formatDate(device.enrolledAt) : "—"}</span>
                {device.assignedUser && (
                  <span>
                    Assigned to <span className="text-foreground">{device.assignedUser.displayName}</span>
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <CountChip icon={Package} label="Software" value={counts.software} tone="neutral" onClick={() => setTab("software")} />
                <CountChip icon={PackageX} label="Unauthorized" value={counts.unauthorizedSoftware} tone="high" onClick={() => setTab("software")} />
                <CountChip
                  icon={AlertTriangle}
                  label="Missing patches"
                  value={counts.missingPatches}
                  tone="medium"
                  onClick={() => {
                    setPatchPreset("MISSING");
                    setTab("patches");
                  }}
                />
                <CountChip icon={Usb} label="USB blocked (7d)" value={counts.usbBlocked7d} tone="critical" onClick={() => setTab("usb")} />
                {can("alerts:read") ? (
                  <Link href={`/alerts?deviceId=${device.id}`} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <CountChipInner icon={ShieldAlert} label="Open alerts" value={counts.openAlerts} tone="critical" />
                  </Link>
                ) : (
                  <CountChipInner icon={ShieldAlert} label="Open alerts" value={counts.openAlerts} tone="critical" />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex items-center gap-3">
              <ScoreRing score={device.complianceState === "UNKNOWN" ? null : device.complianceScore} size={64} stroke={5.5} />
              <div className="grid gap-1.5">
                <ComplianceBadge value={device.complianceState} />
                <RiskBadge value={device.riskLevel} />
                <span className="text-[11px] text-muted-foreground">
                  Evaluated <RelativeTime value={device.lastEvaluatedAt} />
                </span>
              </div>
            </div>
            <DeviceActions device={device} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <TabsList aria-label="Device sections">
          {visibleTabs.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABELS[t]}
              {t === "software" && counts.software > 0 && <TabCount value={counts.software} />}
              {t === "patches" && counts.missingPatches > 0 && <TabCount value={counts.missingPatches} tone="medium" />}
              {t === "usb" && counts.usbBlocked7d > 0 && <TabCount value={counts.usbBlocked7d} tone="critical" />}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab device={device} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab device={device} />
        </TabsContent>
        <TabsContent value="compliance">
          <ComplianceTab device={device} />
        </TabsContent>
        <TabsContent value="software">
          <SoftwareTab deviceId={device.id} deviceName={device.deviceName} />
        </TabsContent>
        <TabsContent value="patches">
          <PatchesTab key={patchPreset ?? "all"} deviceId={device.id} initialState={patchPreset} />
        </TabsContent>
        <TabsContent value="usb">
          <UsbEventsTab deviceId={device.id} />
        </TabsContent>
        <TabsContent value="commands">
          <CommandsTab deviceId={device.id} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab deviceId={device.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TabCount({ value, tone = "neutral" }: { value: number; tone?: Tone }) {
  return <span className={cn("rounded px-1 text-[10px] font-semibold tabular ring-1 ring-inset", toneBadge[tone])}>{value > 999 ? "999+" : value}</span>;
}

function CountChipInner({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: Tone }) {
  const active = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ring-1 ring-inset transition-colors",
        active ? toneBadge[tone] : "bg-muted/40 text-muted-foreground ring-border",
      )}
    >
      <Icon className="size-3.5" />
      <span className="font-semibold tabular">{value}</span>
      <span className={cn(active && tone !== "neutral" ? "" : "text-muted-foreground")}>{label}</span>
    </span>
  );
}

function CountChip(props: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: Tone; onClick: () => void }) {
  const { onClick, ...rest } = props;
  return (
    <button type="button" onClick={onClick} className="rounded-md hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CountChipInner {...rest} />
    </button>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading device">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:justify-between">
          <div className="flex gap-3">
            <Skeleton className="size-12 rounded-lg" />
            <div className="grid gap-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-3 w-80 max-w-[70vw]" />
              <Skeleton className="h-3 w-64 max-w-[60vw]" />
              <div className="mt-1 flex gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-24" />
                ))}
              </div>
            </div>
          </div>
          <Skeleton className="size-16 rounded-full" />
        </CardContent>
      </Card>
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
