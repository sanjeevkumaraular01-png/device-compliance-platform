"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BrickWall, Fingerprint, HardDrive, Lock, MonitorSmartphone, Radar, RefreshCw, ShieldCheck, Usb, Power } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { BoolBadge, StatusBadge } from "@/components/common/status-badges";
import { RelativeTime } from "@/components/common/misc";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { protectionMeta, toneBadge, toneDot, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DeviceDetail, ProtectionState, SecurityStatus } from "@/types/api";

function boolTone(v: boolean | null | undefined, invert = false, falseTone: Tone = "critical"): Tone {
  if (v === null || v === undefined) return "unknown";
  return (invert ? !v : v) ? "success" : falseTone;
}

function stateTone(s: ProtectionState | null | undefined): Tone {
  return s ? (protectionMeta[s]?.tone ?? "unknown") : "unknown";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

function ControlCard({
  title,
  icon: Icon,
  tone,
  status,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  status: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <span className={cn("absolute inset-x-0 top-0 h-0.5", toneDot[tone])} aria-hidden />
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-md ring-1 ring-inset", toneBadge[tone])}>
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{title}</p>
            <div className="mt-1">{status}</div>
          </div>
        </div>
        {children && <div className="mt-3 divide-y border-t pt-1">{children}</div>}
      </CardContent>
    </Card>
  );
}

export function SecurityTab({ device }: { device: DeviceDetail }) {
  const q = useQuery({
    queryKey: ["devices", device.id, "security"],
    queryFn: async () => {
      try {
        return (await api.get<SecurityStatus | null>(`/devices/${device.id}/security`)) ?? null;
      } catch (e) {
        if (e instanceof ApiError && e.isNotFound) return null;
        throw e;
      }
    },
    placeholderData: device.securityStatus ?? undefined,
  });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  if (!s) {
    return (
      <Card>
        <EmptyState
          icon={ShieldCheck}
          title="No security data yet"
          description="The agent has not reported the device's security posture. Data appears after the first inventory report."
        />
      </Card>
    );
  }

  const sigAgeDays = s.antivirusSignatureAt ? Math.floor((Date.now() - new Date(s.antivirusSignatureAt).getTime()) / 86_400_000) : null;
  const screenTone = boolTone(s.screenLockEnabled);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ControlCard title="Antivirus" icon={ShieldCheck} tone={stateTone(s.antivirusState)} status={<StatusBadge value={s.antivirusState} meta={protectionMeta} />}>
          <Row label="Product">{s.antivirusProduct ?? "—"}</Row>
          <Row label="Signatures">
            {s.antivirusSignatureAt ? (
              <span title={formatDateTime(s.antivirusSignatureAt)} className={cn(sigAgeDays !== null && sigAgeDays > 7 && "font-medium text-sev-medium")}>
                {formatRelative(s.antivirusSignatureAt)}
              </span>
            ) : (
              "—"
            )}
          </Row>
        </ControlCard>

        <ControlCard title="EDR" icon={Radar} tone={stateTone(s.edrState)} status={<StatusBadge value={s.edrState} meta={protectionMeta} />}>
          <Row label="Product">{s.edrProduct ?? "—"}</Row>
        </ControlCard>

        <ControlCard title="Firewall" icon={BrickWall} tone={stateTone(s.firewallState)} status={<StatusBadge value={s.firewallState} meta={protectionMeta} />}>
          <Row label="All profiles">{protectionMeta[s.firewallState]?.label ?? "—"}</Row>
        </ControlCard>

        <ControlCard
          title="BitLocker"
          icon={Lock}
          tone={device.platform === "WINDOWS" ? stateTone(s.bitlockerState) : "neutral"}
          status={device.platform === "WINDOWS" ? <StatusBadge value={s.bitlockerState} meta={protectionMeta} /> : <span className="text-xs text-muted-foreground">Windows only</span>}
        >
          <Row label="System drive">{device.platform === "WINDOWS" ? (protectionMeta[s.bitlockerState]?.label ?? "—") : "N/A"}</Row>
        </ControlCard>

        <ControlCard
          title="Disk encryption"
          icon={HardDrive}
          tone={stateTone(s.diskEncryptionState)}
          status={<StatusBadge value={s.diskEncryptionState} meta={protectionMeta} />}
        >
          <Row label="Method">{s.encryptionMethod ?? "—"}</Row>
        </ControlCard>

        <ControlCard title="Secure Boot" icon={Fingerprint} tone={stateTone(s.secureBootState)} status={<StatusBadge value={s.secureBootState} meta={protectionMeta} />}>
          <Row label="TPM present">
            <BoolBadge value={s.tpmPresent} />
          </Row>
        </ControlCard>

        <ControlCard title="Screen lock" icon={MonitorSmartphone} tone={screenTone} status={<BoolBadge value={s.screenLockEnabled} trueLabel="Enabled" falseLabel="Disabled" />}>
          <Row label="Timeout">{formatDuration(s.screenLockTimeoutSec)}</Row>
          <Row label="Password on wake">
            <BoolBadge value={s.passwordOnWake} />
          </Row>
          <Row label="Screen saver">
            <BoolBadge value={s.screenSaverEnabled} />
          </Row>
        </ControlCard>

        <ControlCard
          title="Automatic updates"
          icon={RefreshCw}
          tone={boolTone(s.autoUpdateEnabled, false, "medium")}
          status={<BoolBadge value={s.autoUpdateEnabled} trueLabel="Enabled" falseLabel="Disabled" />}
        >
          <Row label="Pending reboot">
            <BoolBadge value={s.pendingRebootRequired} invert trueLabel="Required" falseLabel="No" />
          </Row>
        </ControlCard>

        <ControlCard
          title="USB storage"
          icon={Usb}
          tone={boolTone(s.usbStorageEnabled, true, "high")}
          status={<BoolBadge value={s.usbStorageEnabled} invert trueLabel="Allowed" falseLabel="Blocked" />}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Power className="size-3.5" /> Pending reboot:{" "}
            <BoolBadge value={s.pendingRebootRequired} invert trueLabel="Required" falseLabel="No" />
          </span>
          <span>
            Last boot: <span className="text-foreground">{s.lastBootAt ? formatDateTime(s.lastBootAt) : "—"}</span>
          </span>
          <span>
            Collected: <RelativeTime value={s.collectedAt} className="text-foreground" /> <span className="hidden sm:inline">({formatDateTime(s.collectedAt)})</span>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
