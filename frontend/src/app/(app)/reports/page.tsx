"use client";

import * as React from "react";
import { CalendarClock, FileBarChart, FilePlus2, FileText } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Can } from "@/lib/auth";
import { GenerateReportDialog } from "@/components/reports/generate-report-dialog";
import { ReportsTable } from "@/components/reports/reports-table";
import { SchedulesTable } from "@/components/reports/schedules-table";
import { ScheduleDialog } from "@/components/reports/schedule-dialog";

export default function ReportsPage() {
  const [tab, setTab] = React.useState("reports");
  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Reports"
        icon={FileBarChart}
        description="Generate compliance, inventory and security reports as PDF, Excel or CSV, or schedule them for email delivery."
        actions={
          <Can permission="reports:create">
            <Button onClick={() => setGenerateOpen(true)}>
              <FilePlus2 /> Generate report
            </Button>
          </Can>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="reports">
            <FileText /> Reports
          </TabsTrigger>
          <TabsTrigger value="schedules">
            <CalendarClock /> Schedules
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reports">
          <ReportsTable onGenerate={() => setGenerateOpen(true)} />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesTable onCreate={() => setScheduleOpen(true)} />
        </TabsContent>
      </Tabs>

      <GenerateReportDialog open={generateOpen} onOpenChange={setGenerateOpen} />
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </>
  );
}
