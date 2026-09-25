"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { ProtectionOverview, type SecurityFilterKey } from "@/components/security/protection-overview";
import { SecurityDevicesTable } from "@/components/security/security-devices-table";
import { useListQuery } from "@/hooks/use-list-query";
import type { ProtectionState, SecurityDeviceRow } from "@/types/api";

export default function SecurityPage() {
  const list = useListQuery<SecurityDeviceRow>("security", "/security/devices", {
    initial: { sortBy: "collectedAt", sortOrder: "desc" },
  });
  const tableRef = React.useRef<HTMLDivElement>(null);
  const { setFilter } = list;

  const onSelect = React.useCallback(
    (key: SecurityFilterKey, state: ProtectionState | undefined) => {
      setFilter(key, state);
      if (state) tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [setFilter],
  );

  const f = list.state.filters;
  const filters: Partial<Record<SecurityFilterKey, string | undefined>> = {
    antivirusState: typeof f.antivirusState === "string" ? f.antivirusState : undefined,
    edrState: typeof f.edrState === "string" ? f.edrState : undefined,
    firewallState: typeof f.firewallState === "string" ? f.firewallState : undefined,
    diskEncryptionState: typeof f.diskEncryptionState === "string" ? f.diskEncryptionState : undefined,
  };

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <PageHeader
          title="Security posture"
          icon={ShieldCheck}
          description="Endpoint protection coverage across the fleet: antivirus, EDR, firewall, encryption, Secure Boot and screen lock."
        />
        <ProtectionOverview filters={filters} onSelect={onSelect} />
      </div>
      <div ref={tableRef} className="min-w-0 scroll-mt-20">
        <SectionTitle title="Device protection status" description="Latest security report per device. Click a state in the cards above to filter." />
        <SecurityDevicesTable list={list} />
      </div>
    </div>
  );
}
