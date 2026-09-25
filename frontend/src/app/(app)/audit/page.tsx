"use client";

import { LogIn, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditLogTab } from "@/components/audit/audit-log-tab";
import { LoginHistoryTab } from "@/components/audit/login-history-tab";

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit Logs"
        icon={ScrollText}
        description="Tamper-evident record of administrative actions, device changes and console sign-ins."
      />
      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">
            <ScrollText /> Audit log
          </TabsTrigger>
          <TabsTrigger value="logins">
            <LogIn /> Login history
          </TabsTrigger>
        </TabsList>
        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
        <TabsContent value="logins">
          <LoginHistoryTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
