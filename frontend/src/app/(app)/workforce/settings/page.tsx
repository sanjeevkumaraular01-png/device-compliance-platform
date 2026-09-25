"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, Inbox, ShieldCheck, SlidersHorizontal, Tags, Webhook } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { PoliciesTab } from "@/components/workforce/settings/policies-tab";
import { AppRulesTab } from "@/components/workforce/settings/app-rules-tab";
import { UncategorizedTab } from "@/components/workforce/settings/uncategorized-tab";
import { HrmsTab } from "@/components/workforce/settings/hrms-tab";
import { AiStatusCard } from "@/components/workforce/ai/ai-status-card";

const TABS = ["policies", "categories", "uncategorized", "hrms", "ai"] as const;
type Tab = (typeof TABS)[number];

export default function WorkforceSettingsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <WorkforceSettingsInner />
    </React.Suspense>
  );
}

function WorkforceSettingsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAuth();

  const raw = searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "policies";
  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (t === "policies") p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="min-w-0">
      <PageHeader
        title="Workforce Settings"
        icon={SlidersHorizontal}
        description="Workforce policies, app & website categories, the uncategorized queue, HRMS export and AI status."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="policies">
            <ShieldCheck /> Policies
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tags /> App &amp; website categories
          </TabsTrigger>
          <TabsTrigger value="uncategorized">
            <Inbox /> Uncategorized
          </TabsTrigger>
          <TabsTrigger value="hrms">
            <Webhook /> HRMS integration
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Bot /> AI
          </TabsTrigger>
        </TabsList>
        <TabsContent value="policies">
          <PoliciesTab />
        </TabsContent>
        <TabsContent value="categories">
          <AppRulesTab />
        </TabsContent>
        <TabsContent value="uncategorized">
          <UncategorizedTab />
        </TabsContent>
        <TabsContent value="hrms">
          <HrmsTab />
        </TabsContent>
        <TabsContent value="ai">
          <div className="grid grid-cols-1 gap-3">
            <AiStatusCard showLink={can("workforce:ai")} />
            <p className="text-xs text-muted-foreground">
              AI summaries use tracked activity metrics, tasks and daily reports only — never screenshots, window titles, keystrokes or email addresses.
              {can("workforce:ai") && (
                <>
                  {" "}
                  <Button asChild variant="link" size="xs" className="h-auto p-0 text-xs">
                    <Link href="/workforce/ai">View AI insights →</Link>
                  </Button>
                </>
              )}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
