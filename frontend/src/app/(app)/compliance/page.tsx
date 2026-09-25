"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck, ListChecks, PlayCircle, ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { PageHeader } from "@/components/common/page-header";
import { TableSkeleton } from "@/components/common/states";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComplianceSummaryCharts } from "@/components/compliance/compliance-summary";
import { RulesTable } from "@/components/compliance/rules-table";
import { ResultsTable } from "@/components/compliance/results-table";
import { formatNumber } from "@/lib/format";

const TABS = ["rules", "results"] as const;
type TabKey = (typeof TABS)[number];

function EvaluateAllButton() {
  const confirm = useConfirm();
  const evaluate = useApiMutation(() => api.post<{ queued: number }>("/compliance/evaluate", {}), {
    success: (d) => `Queued ${formatNumber(d?.queued ?? 0)} device${d?.queued === 1 ? "" : "s"} for evaluation`,
    invalidate: [["compliance"]],
  });
  const onClick = async () => {
    const ok = await confirm({
      title: "Re-evaluate all devices?",
      description:
        "Every managed device is queued for a compliance evaluation against its effective policy. Alerts are raised for devices that become non-compliant. Large fleets may take several minutes.",
      confirmLabel: "Evaluate all",
    });
    if (ok) evaluate.mutate();
  };
  return (
    <Button size="sm" onClick={onClick} loading={evaluate.isPending}>
      <PlayCircle /> Evaluate all
    </Button>
  );
}

function ComplianceTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = TABS.includes(raw as TabKey) ? (raw as TabKey) : "rules";

  const setTab = (v: string) => {
    const sp = new URLSearchParams(params.toString());
    if (v === "rules") sp.delete("tab");
    else sp.set("tab", v);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="rules">
          <ListChecks /> Rules
        </TabsTrigger>
        <TabsTrigger value="results">
          <ScrollText /> Results
        </TabsTrigger>
      </TabsList>
      <TabsContent value="results">
        <ResultsTable />
      </TabsContent>
      <TabsContent value="rules">
        <RulesTable />
      </TabsContent>
    </Tabs>
  );
}

export default function CompliancePage() {
  return (
    <>
      <PageHeader
        title="Compliance"
        icon={ClipboardCheck}
        description="Rule-based posture evaluation of every managed endpoint against its effective policy."
        actions={
          <Can permission="compliance:write">
            <EvaluateAllButton />
          </Can>
        }
      />
      <div className="grid gap-5">
        <ComplianceSummaryCharts />
        <React.Suspense fallback={<TableSkeleton rows={8} />}>
          <ComplianceTabs />
        </React.Suspense>
      </div>
    </>
  );
}
