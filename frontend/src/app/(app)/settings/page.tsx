"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Globe, MonitorDown, MonitorSmartphone, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { TableSkeleton } from "@/components/common/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { ProfileTab } from "@/components/settings/profile-tab";
import { ChangePasswordCard, PASSWORD_ANCHOR } from "@/components/settings/change-password-card";
import { MfaCard } from "@/components/settings/mfa-card";
import { SessionsTab } from "@/components/settings/sessions-tab";
import { IpRestrictionsTab } from "@/components/settings/ip-restrictions-tab";
import { SystemTab } from "@/components/settings/system-tab";
import { DeploymentTab } from "@/components/settings/deployment-tab";

const BASE_TABS = ["profile", "security", "sessions"] as const;
const ADMIN_TABS = ["ip", "system", "deployment"] as const;
type TabId = (typeof BASE_TABS)[number] | (typeof ADMIN_TABS)[number];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" icon={Settings} description="Your profile and account security, plus console-wide configuration for administrators." />
      <React.Suspense fallback={<TableSkeleton rows={4} />}>
        <SettingsTabs />
      </React.Suspense>
    </>
  );
}

function SettingsTabs() {
  const { can, user, mfaEnrollmentRequired } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = can("settings:write");

  const allowed: readonly TabId[] = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  const requested = searchParams.get("tab") as TabId | null;
  const tab: TabId = requested && allowed.includes(requested) ? requested : "profile";
  const enroll = (searchParams.get("enroll") === "1" || mfaEnrollmentRequired) && !!user && !user.mfaEnabled;

  const onTabChange = (next: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    sp.delete("enroll");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  // Honor the #password anchor (user menu → "Change password") once the security tab is rendered.
  React.useEffect(() => {
    if (tab !== "security") return;
    const focusAnchor = () => {
      const hash = window.location.hash.slice(1);
      if (hash !== PASSWORD_ANCHOR && hash !== "mfa") return;
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (hash === PASSWORD_ANCHOR) document.getElementById("pw-current")?.focus({ preventScroll: true });
    };
    const t = window.setTimeout(focusAnchor, 50);
    window.addEventListener("hashchange", focusAnchor);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", focusAnchor);
    };
  }, [tab, searchParams]);

  // When MFA enrolment is mandatory, bring the MFA card into view.
  React.useEffect(() => {
    if (tab === "security" && enroll) document.getElementById("mfa")?.scrollIntoView({ block: "start" });
  }, [tab, enroll]);

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="profile">
          <UserRound /> Profile
        </TabsTrigger>
        <TabsTrigger value="security">
          <ShieldCheck /> Security
        </TabsTrigger>
        <TabsTrigger value="sessions">
          <MonitorSmartphone /> Sessions
        </TabsTrigger>
        {isAdmin && (
          <>
            <TabsTrigger value="ip">
              <Globe /> IP restrictions
            </TabsTrigger>
            <TabsTrigger value="system">
              <SlidersHorizontal /> System
            </TabsTrigger>
            <TabsTrigger value="deployment">
              <MonitorDown /> Deployment
            </TabsTrigger>
          </>
        )}
      </TabsList>

      <TabsContent value="profile">
        <ProfileTab />
      </TabsContent>

      <TabsContent value="security">
        <div className="grid max-w-3xl gap-4">
          {enroll && (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-sev-critical/40 bg-sev-critical/10 p-4">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-sev-critical" />
              <div className="grid gap-1">
                <p className="text-sm font-semibold">Multi-factor authentication is mandatory for your role</p>
                <p className="text-xs text-muted-foreground">
                  Your organization requires {user?.roleName ?? "your role"} accounts to use MFA. Set up an authenticator app below to continue using
                  the console — other pages stay unavailable until enrolment is complete.
                </p>
              </div>
            </div>
          )}
          <MfaCard enrollRequired={enroll} />
          <ChangePasswordCard />
        </div>
      </TabsContent>

      <TabsContent value="sessions">
        <SessionsTab />
      </TabsContent>

      {isAdmin && (
        <>
          <TabsContent value="ip">
            <IpRestrictionsTab />
          </TabsContent>
          <TabsContent value="system">
            <SystemTab />
          </TabsContent>
          <TabsContent value="deployment">
            <DeploymentTab />
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}
