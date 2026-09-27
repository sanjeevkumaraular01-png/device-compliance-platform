"use client";

import { Network, RadioTower } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyValueGrid } from "@/components/common/misc";
import { EmptyState } from "@/components/common/states";
import type { DeviceDetail } from "@/types/api";

function SectionIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <Icon className="size-4 text-muted-foreground" />;
}

export function NetworkTab({ device }: { device: DeviceDetail }) {
  const adapters = device.networkAdapters ?? [];
  const dns = device.dnsServers ?? [];
  const macs = device.macAddresses ?? [];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={Network} />
          <CardTitle>Network configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            cols={2}
            items={[
              { label: "Primary IP", value: device.ipAddress, mono: true },
              { label: "Default Gateway", value: device.gateway, mono: true },
              { label: "DNS Servers", value: dns.length ? <span className="font-mono text-xs">{dns.join(", ")}</span> : null },
              {
                label: "MAC Addresses",
                value: macs.length ? <span className="font-mono text-xs">{macs.join(", ")}</span> : null,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <SectionIcon icon={RadioTower} />
          <CardTitle>Network adapters</CardTitle>
        </CardHeader>
        <CardContent>
          {adapters.length === 0 ? (
            <EmptyState icon={RadioTower} title="No adapter details" description="The agent has not reported per-adapter network details for this device yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Adapter</th>
                    <th className="py-2 pr-4 font-medium">MAC</th>
                    <th className="py-2 pr-4 font-medium">IP addresses</th>
                    <th className="py-2 pr-4 font-medium">Gateway</th>
                    <th className="py-2 pr-4 font-medium">DNS suffix</th>
                  </tr>
                </thead>
                <tbody>
                  {adapters.map((a, i) => (
                    <tr key={`${a.name}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-4">{a.name || "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{a.macAddress || "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{(a.ipAddresses ?? []).join(", ") || "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{a.gateway || "—"}</td>
                      <td className="py-2 pr-4">{a.dnsSuffix || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
