"use client";

import { Bug, CheckCircle2, HardDrive, Laptop, PackageX, ShieldAlert, Usb, Wrench } from "lucide-react";
import { KpiCard, SegmentBar } from "@/components/common/kpi-card";
import { ErrorState } from "@/components/common/states";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatPercent, pct } from "@/lib/format";
import { rateTone } from "@/lib/status";
import { useDashboardSummary } from "@/components/dashboard/queries";

export function KpiGrid() {
  const { can } = useAuth();
  const q = useDashboardSummary();
  const s = q.data;
  const loading = q.isLoading || (!s && !q.isError);

  if (q.isError && !s) {
    return (
      <Card>
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} title="Could not load fleet summary" />
      </Card>
    );
  }

  const link = (perm: string, href: string) => (can(perm) ? href : undefined);

  const total = s?.totalDevices ?? 0;
  const complianceRate = s?.complianceRate ?? 0;
  const nonCompliantPct = pct(s?.nonCompliantDevices ?? 0, total);
  const enc = s?.encryption ?? { encrypted: 0, notEncrypted: 0, unknown: 0 };
  const encTotal = enc.encrypted + enc.notEncrypted + enc.unknown;
  const encRate = pct(enc.encrypted, encTotal);
  const patches = s?.patches ?? { upToDate: 0, missingCritical: 0, missingTotal: 0, devicesWithMissing: 0 };
  const patchRate = pct(patches.upToDate, patches.upToDate + patches.devicesWithMissing);
  const sw = s?.softwareViolations ?? { unauthorized: 0, blacklisted: 0, devicesAffected: 0 };
  const usb = s?.usbViolations ?? { last24h: 0, last7d: 0 };

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Total Devices"
        icon={Laptop}
        tone="primary"
        loading={loading}
        href={link("devices:read", "/devices")}
        value={formatNumber(total)}
        sub={
          <>
            {formatNumber(s?.onlineDevices)} online · {formatNumber(s?.unknownDevices)} not yet evaluated
          </>
        }
        footer={
          <SegmentBar
            segments={[
              { value: s?.compliantDevices ?? 0, tone: "success", label: "Compliant" },
              { value: s?.nonCompliantDevices ?? 0, tone: "critical", label: "Non-compliant" },
              { value: s?.unknownDevices ?? 0, tone: "unknown", label: "Unknown" },
            ]}
          />
        }
      />
      <KpiCard
        label="Compliant Devices"
        icon={CheckCircle2}
        tone="success"
        loading={loading}
        href={link("compliance:read", "/compliance")}
        value={formatNumber(s?.compliantDevices)}
        sub={
          <>
            Compliance rate <span className="font-medium text-foreground">{formatPercent(complianceRate)}</span> · avg. score{" "}
            {formatNumber(s?.averageScore)}
          </>
        }
        footer={<Progress value={complianceRate} tone={rateTone(complianceRate)} aria-label="Compliance rate" />}
      />
      <KpiCard
        label="Non-Compliant Devices"
        icon={ShieldAlert}
        tone={(s?.nonCompliantDevices ?? 0) > 0 ? "critical" : "success"}
        loading={loading}
        href={link("compliance:read", "/compliance")}
        value={formatNumber(s?.nonCompliantDevices)}
        sub={<>{formatPercent(nonCompliantPct)} of the fleet</>}
      />
      <KpiCard
        label="Critical Risks"
        icon={Bug}
        tone={(s?.criticalRisks ?? 0) > 0 ? "critical" : "success"}
        loading={loading}
        href={link("devices:read", "/devices?riskLevel=CRITICAL")}
        value={formatNumber(s?.criticalRisks)}
        sub={<>{formatNumber(s?.highRisks)} more devices at high risk</>}
      />
      <KpiCard
        label="USB Violations"
        icon={Usb}
        tone={usb.last24h > 0 ? "high" : usb.last7d > 0 ? "medium" : "success"}
        loading={loading}
        href={link("usb:read", "/usb")}
        value={formatNumber(usb.last24h)}
        sub={
          <>
            Blocked in last 24h · <span className="font-medium text-foreground">{formatNumber(usb.last7d)}</span> in 7 days
          </>
        }
      />
      <KpiCard
        label="Software Violations"
        icon={PackageX}
        tone={sw.blacklisted > 0 ? "critical" : sw.unauthorized > 0 ? "high" : "success"}
        loading={loading}
        href={link("software:read", "/software")}
        value={formatNumber(sw.unauthorized + sw.blacklisted)}
        sub={
          <>
            {formatNumber(sw.unauthorized)} unauthorized · {formatNumber(sw.blacklisted)} blacklisted · {formatNumber(sw.devicesAffected)} devices
          </>
        }
      />
      <KpiCard
        label="Encryption Status"
        icon={HardDrive}
        tone={encTotal ? rateTone(encRate) : "unknown"}
        loading={loading}
        href={link("security:read", "/security")}
        value={encTotal ? formatPercent(encRate) : "—"}
        sub={
          <>
            {formatNumber(enc.encrypted)} encrypted · {formatNumber(enc.notEncrypted)} not encrypted
            {enc.unknown > 0 && <> · {formatNumber(enc.unknown)} unknown</>}
          </>
        }
        footer={
          <SegmentBar
            segments={[
              { value: enc.encrypted, tone: "success", label: "Encrypted" },
              { value: enc.notEncrypted, tone: "critical", label: "Not encrypted" },
              { value: enc.unknown, tone: "unknown", label: "Unknown" },
            ]}
          />
        }
      />
      <KpiCard
        label="Patch Status"
        icon={Wrench}
        tone={patches.missingCritical > 0 ? "critical" : patches.devicesWithMissing > 0 ? "medium" : "success"}
        loading={loading}
        href={link("patches:read", "/patches")}
        value={patches.upToDate + patches.devicesWithMissing ? formatPercent(patchRate) : "—"}
        sub={
          <>
            {formatNumber(patches.missingCritical)} critical missing · {formatNumber(patches.devicesWithMissing)} devices need updates
          </>
        }
        footer={
          <SegmentBar
            segments={[
              { value: patches.upToDate, tone: "success", label: "Up to date" },
              { value: patches.devicesWithMissing, tone: "high", label: "Missing updates" },
            ]}
          />
        }
      />
    </div>
  );
}
