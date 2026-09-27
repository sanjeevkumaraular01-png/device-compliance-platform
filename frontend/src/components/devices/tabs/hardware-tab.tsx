"use client";

import { Cpu, HardDrive, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyValueGrid } from "@/components/common/misc";
import { formatDateTime, formatRam, formatStorage, humanize } from "@/lib/format";
import type { DeviceDetail } from "@/types/api";

function SectionIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <Icon className="size-4 text-muted-foreground" />;
}

function uptimeFrom(lastBootAt?: string | null): string | null {
  if (!lastBootAt) return null;
  const ms = Date.now() - new Date(lastBootAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function HardwareTab({ device }: { device: DeviceDetail }) {
  const lastBootAt = device.securityStatus?.lastBootAt ?? null;
  const battery =
    device.batteryPercent != null
      ? `${device.batteryPercent}%${device.batteryStatus ? ` (${device.batteryStatus})` : ""}`
      : device.batteryStatus || null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={Cpu} />
          <CardTitle>System</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            cols={2}
            items={[
              { label: "Manufacturer", value: device.manufacturer },
              { label: "Model", value: device.model },
              { label: "Serial Number", value: device.serialNumber, mono: true },
              { label: "Asset ID", value: device.assetId, mono: true },
              { label: "Device Type", value: humanize(device.deviceType) },
              { label: "BIOS Version", value: device.biosVersion, mono: true },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={HardDrive} />
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            cols={2}
            items={[
              { label: "CPU", value: device.cpu ? <span title={device.cpu}>{device.cpu}</span> : null },
              { label: "RAM", value: formatRam(device.ramMb) },
              { label: "Storage", value: formatStorage(device.storageGb) },
              { label: "GPU", value: device.gpu ? <span title={device.gpu}>{device.gpu}</span> : null },
              { label: "Battery", value: battery },
            ]}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={Monitor} />
          <CardTitle>Operating System</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            cols={3}
            items={[
              { label: "OS", value: device.osName },
              { label: "Edition", value: device.osEdition },
              { label: "Architecture", value: device.osArch },
              { label: "Version", value: device.osVersion },
              { label: "Build", value: device.osBuild, mono: true },
              { label: "Hostname", value: device.hostname, mono: true },
              { label: "Last Boot", value: lastBootAt ? formatDateTime(lastBootAt) : null },
              { label: "Uptime", value: uptimeFrom(lastBootAt) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
