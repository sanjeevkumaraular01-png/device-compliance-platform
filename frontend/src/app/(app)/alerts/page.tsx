"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BellRing, Siren } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { AlertsTab } from "@/components/alerts/alerts-tab";
import { ChannelsTab } from "@/components/alerts/channels-tab";

type Tab = "alerts" | "channels";

export default function AlertsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AlertsPageInner />
    </React.Suspense>
  );
}

function AlertsPageInner() {
  const { can } = useAuth();
  const canConfigure = can("alerts:configure");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("tab");
  const tab: Tab = raw === "channels" && canConfigure ? "channels" : "alerts";
  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (t === "alerts") p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div>
      <PageHeader
        title="Alerts"
        icon={AlertTriangle}
        description="Security and compliance alerts raised across the fleet, and where they are delivered."
      />
      {canConfigure ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="alerts">
              <Siren /> Alerts
            </TabsTrigger>
            <TabsTrigger value="channels">
              <BellRing /> Channels
            </TabsTrigger>
          </TabsList>
          <TabsContent value="alerts">
            <AlertsTab />
          </TabsContent>
          <TabsContent value="channels">
            <ChannelsTab />
          </TabsContent>
        </Tabs>
      ) : (
        <AlertsTab />
      )}
    </div>
  );
}
