"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, FileKey2, Package, PackageCheck, PackageX, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Can } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { SoftwareInventoryTab } from "@/components/software/inventory-tab";
import { SoftwareUnauthorizedTab } from "@/components/software/unauthorized-tab";
import { SoftwareWhitelistTab } from "@/components/software/whitelist-tab";
import { SoftwareBlacklistTab } from "@/components/software/blacklist-tab";
import { SoftwareLicensesTab } from "@/components/software/licenses-tab";

const TABS = ["inventory", "unauthorized", "catalog", "blacklist", "licenses"] as const;
type Tab = (typeof TABS)[number];

export default function SoftwarePage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SoftwarePageInner />
    </React.Suspense>
  );
}

function SoftwarePageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();

  const raw = searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "inventory";
  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (t === "inventory") p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const reclassify = useApiMutation(() => api.post<{ updated: number }>("/software/reclassify"), {
    success: (res) => `${formatNumber(res?.updated ?? 0)} item${res?.updated === 1 ? "" : "s"} updated`,
    invalidate: [["software"], ["dashboard"]],
  });

  const onReclassify = async () => {
    const ok = await confirm({
      title: "Re-classify all inventory?",
      description: "Every reported installation is matched again against the approved catalog and blacklist. Status changes may raise alerts and affect compliance scores.",
      confirmLabel: "Re-classify",
    });
    if (ok) reclassify.mutate();
  };

  return (
    <div>
      <PageHeader
        title="Software"
        icon={Package}
        description="Installed applications, unauthorized software, approved catalog, blacklist and license compliance."
        actions={
          <Can permission="software:write">
            <Button variant="outline" size="sm" onClick={onReclassify} loading={reclassify.isPending}>
              <RefreshCw /> Re-classify inventory
            </Button>
          </Can>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inventory">
            <Package /> Inventory
          </TabsTrigger>
          <TabsTrigger value="unauthorized">
            <PackageX /> Unauthorized
          </TabsTrigger>
          <TabsTrigger value="catalog">
            <PackageCheck /> Approved catalog
          </TabsTrigger>
          <TabsTrigger value="blacklist">
            <Ban /> Blacklist
          </TabsTrigger>
          <TabsTrigger value="licenses">
            <FileKey2 /> Licenses
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inventory">
          <SoftwareInventoryTab />
        </TabsContent>
        <TabsContent value="unauthorized">
          <SoftwareUnauthorizedTab />
        </TabsContent>
        <TabsContent value="catalog">
          <SoftwareWhitelistTab />
        </TabsContent>
        <TabsContent value="blacklist">
          <SoftwareBlacklistTab />
        </TabsContent>
        <TabsContent value="licenses">
          <SoftwareLicensesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
