"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, CalendarDays, CalendarOff, Table2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceDailyTab } from "@/components/workforce/attendance/daily-tab";
import { AttendanceMonthlyTab } from "@/components/workforce/attendance/monthly-tab";
import { AttendanceLeaveTab } from "@/components/workforce/attendance/leave-tab";

const TABS = ["daily", "monthly", "leave"] as const;
type Tab = (typeof TABS)[number];

export default function AttendancePage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AttendancePageInner />
    </React.Suspense>
  );
}

function AttendancePageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "daily";
  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (t === "daily") p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="min-w-0">
      <PageHeader
        title="Attendance"
        icon={CalendarCheck}
        description="Daily clock-in records, the monthly attendance sheet and leave. Corrections are audited."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="daily">
            <CalendarDays /> Daily
          </TabsTrigger>
          <TabsTrigger value="monthly">
            <Table2 /> Monthly sheet
          </TabsTrigger>
          <TabsTrigger value="leave">
            <CalendarOff /> Leave
          </TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="min-w-0">
          <AttendanceDailyTab />
        </TabsContent>
        <TabsContent value="monthly" className="min-w-0">
          <AttendanceMonthlyTab />
        </TabsContent>
        <TabsContent value="leave" className="min-w-0">
          <AttendanceLeaveTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
