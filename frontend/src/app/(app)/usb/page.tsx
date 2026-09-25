"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, ClipboardList, ShieldCheck, Usb } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Can, useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { normalizeList } from "@/hooks/use-list-query";
import { UsbRequestDialog } from "@/components/usb/usb-request-dialog";
import { UsbStatsPanel } from "@/components/usb/usb-stats-panel";
import { UsbEventsTab } from "@/components/usb/usb-events-tab";
import { UsbWhitelistTab } from "@/components/usb/usb-whitelist-tab";
import { UsbRequestsTable } from "@/components/usb/usb-requests-table";
import { UsbEmployeeView } from "@/components/usb/usb-employee-view";
import type { Paginated, UsbAccessRequest } from "@/types/api";

const TABS = ["events", "whitelist", "requests"] as const;
type Tab = (typeof TABS)[number];

export default function UsbPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <UsbPageInner />
    </React.Suspense>
  );
}

function UsbPageInner() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canRead = can("usb:read");

  const raw = searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "events";
  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (t === "events") p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const pending = useQuery({
    queryKey: ["usb", "requests", "pending-count"],
    queryFn: async () => normalizeList(await api.get<Paginated<UsbAccessRequest> | UsbAccessRequest[]>("/usb/requests", { status: "PENDING", pageSize: 1 })).meta.total,
    enabled: canRead,
    refetchInterval: 60_000,
  });

  if (!canRead) return <UsbEmployeeView />;

  return (
    <div>
      <PageHeader
        title="USB Control"
        icon={Usb}
        description="Removable media activity, approved devices and temporary access requests across the fleet."
        actions={
          <Can permission="usb:request">
            <UsbRequestDialog />
          </Can>
        }
      />
      <UsbStatsPanel />
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="events">
            <Activity /> Events
          </TabsTrigger>
          <TabsTrigger value="whitelist">
            <ShieldCheck /> Whitelist
          </TabsTrigger>
          <TabsTrigger value="requests">
            <ClipboardList /> Access requests
            {!!pending.data && (
              <span className="ml-0.5 rounded-full bg-sev-medium/15 px-1.5 text-[11px] font-semibold tabular text-sev-medium" aria-label={`${pending.data} pending`}>
                {pending.data}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="events">
          <UsbEventsTab />
        </TabsContent>
        <TabsContent value="whitelist">
          <UsbWhitelistTab />
        </TabsContent>
        <TabsContent value="requests">
          <UsbRequestsTable mode="admin" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
