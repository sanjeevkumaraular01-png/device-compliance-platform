"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IdCard } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { TableSkeleton } from "@/components/common/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DirectoryTab } from "@/components/hr/directory-tab";
import { NoticeTab } from "@/components/hr/notice-tab";

const TABS = ["directory", "notice"] as const;
type Tab = (typeof TABS)[number];

export default function HrPage() {
  return (
    <>
      <PageHeader
        title="Employees"
        icon={IdCard}
        description="Employee directory with assigned laptops, onboarding links, offboarding, and monitoring-notice signatures."
      />
      <React.Suspense fallback={<TableSkeleton rows={6} />}>
        <HrTabs />
      </React.Suspense>
    </>
  );
}

function HrTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "directory";
  const setTab = (t: string) => router.replace(`${pathname}?tab=${t}`, { scroll: false });

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0">
      <TabsList aria-label="HR sections">
        <TabsTrigger value="directory">Directory</TabsTrigger>
        <TabsTrigger value="notice">Monitoring notice</TabsTrigger>
      </TabsList>
      <TabsContent value="directory">
        <DirectoryTab />
      </TabsContent>
      <TabsContent value="notice">
        <NoticeTab />
      </TabsContent>
    </Tabs>
  );
}
