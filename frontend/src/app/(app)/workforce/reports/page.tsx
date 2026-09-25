"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Forbidden } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MyReportTab } from "@/components/workforce/reports/my-report-tab";
import { TeamReportsTab } from "@/components/workforce/reports/team-reports-tab";
import { useAuth } from "@/lib/auth";

type Tab = "mine" | "team";

export default function DailyReportsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <DailyReportsPageInner />
    </React.Suspense>
  );
}

function DailyReportsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAuth();

  const visible: Tab[] = [];
  if (can("workforce:self")) visible.push("mine");
  if (can("workforce:read")) visible.push("team");

  const raw = searchParams.get("tab") as Tab | null;
  const tab: Tab = raw && visible.includes(raw) ? raw : (visible[0] ?? "mine");
  const initialDate = searchParams.get("date");

  const replaceParams = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(searchParams.toString());
    mutate(p);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setTab = (t: string) =>
    replaceParams((p) => {
      if (t === "mine") p.delete("tab");
      else p.set("tab", t);
    });

  return (
    <div className="min-w-0">
      <PageHeader
        title="Daily Work Reports"
        icon={ClipboardList}
        description="What was done each day — structured items with results, blockers and next actions, checked against tracked activity."
      />
      {visible.length === 0 ? (
        <Forbidden />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          {visible.length > 1 && (
            <TabsList>
              <TabsTrigger value="mine">
                <UserRound /> My report
              </TabsTrigger>
              <TabsTrigger value="team">
                <Users /> Team reports
              </TabsTrigger>
            </TabsList>
          )}
          {visible.includes("mine") && (
            <TabsContent value="mine" className={visible.length > 1 ? undefined : "mt-0"}>
              <MyReportTab
                key={initialDate ?? "today"}
                initialDate={initialDate}
                onDateChange={(d) =>
                  replaceParams((p) => {
                    p.set("date", d);
                  })
                }
              />
            </TabsContent>
          )}
          {visible.includes("team") && (
            <TabsContent value="team" className={visible.length > 1 ? undefined : "mt-0"}>
              <TeamReportsTab />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
