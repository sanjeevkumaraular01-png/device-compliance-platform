"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { KeyRound, PlugZap, ShieldQuestion, Terminal } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { TableSkeleton } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokensTab } from "@/components/enrollment/tokens-tab";
import { PendingTab } from "@/components/enrollment/pending-tab";
import { InstallCommandGenerator } from "@/components/enrollment/install-command";
import { useEnrollmentTokens, usePendingDevices } from "@/components/enrollment/enrollment-queries";

const TABS = ["tokens", "install", "pending"] as const;
type TabKey = (typeof TABS)[number];

function EnrollmentContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = TABS.includes(raw as TabKey) ? (raw as TabKey) : "tokens";

  const tokens = useEnrollmentTokens();
  const pending = usePendingDevices();
  const pendingCount = pending.data?.length ?? 0;

  const setTab = (v: string) => {
    const sp = new URLSearchParams(params.toString());
    if (v === "tokens") sp.delete("tab");
    else sp.set("tab", v);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="tokens">
          <KeyRound /> Tokens
        </TabsTrigger>
        <TabsTrigger value="install">
          <Terminal /> Install command
        </TabsTrigger>
        <TabsTrigger value="pending">
          <ShieldQuestion /> Pending approval
          {pendingCount > 0 && (
            <Badge tone="medium" className="ml-0.5 tabular">
              {pendingCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="tokens">
        <TokensTab />
      </TabsContent>

      <TabsContent value="install">
        <Card>
          <CardHeader>
            <CardTitle>Install command generator</CardTitle>
            <CardDescription>
              One-line installers that download the SecureEndpoint agent, trust the enrollment CA and register the device with the selected token.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InstallCommandGenerator tokens={tokens.data ?? []} loading={tokens.isLoading} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pending">
        <PendingTab />
      </TabsContent>
    </Tabs>
  );
}

export default function EnrollmentPage() {
  return (
    <>
      <PageHeader
        title="Enrollment"
        icon={PlugZap}
        description="Issue enrollment tokens, generate agent install commands and verify newly enrolled devices."
      />
      <React.Suspense fallback={<TableSkeleton rows={6} />}>
        <EnrollmentContent />
      </React.Suspense>
    </>
  );
}
