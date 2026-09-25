"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { Sidebar, SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs";
import { BrandMark } from "@/components/layout/logo";
import { findNavItem, isNavVisible } from "@/components/layout/nav";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, Forbidden } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const COLLAPSE_KEY = "sem.sidebarCollapsed";

function FullScreenLoader({ label = "Loading console…" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <BrandMark />
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> {label}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, error, reload, user, can, mfaEnrollmentRequired } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  React.useEffect(() => {
    if (status === "unauthenticated") {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${next}`);
    }
  }, [status, router, pathname]);

  // Enforce MFA enrolment when the backend demands it.
  React.useEffect(() => {
    if (status === "authenticated" && mfaEnrollmentRequired && user && !user.mfaEnabled && pathname !== "/settings") {
      router.replace("/settings?tab=security&enroll=1");
    }
  }, [status, mfaEnrollmentRequired, user, pathname, router]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (status === "loading" || status === "unauthenticated") {
    return <FullScreenLoader label={status === "unauthenticated" ? "Redirecting to sign in…" : "Loading console…"} />;
  }

  if (status === "error") {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
          <BrandMark className="mb-4" />
          <ErrorState error={error} onRetry={() => void reload()} title="Cannot reach SecureEndpoint Manager" compact />
          <div className="mt-2 text-center">
            <Button asChild variant="link" size="sm">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const navItem = findNavItem(pathname);
  const permitted = !navItem || isNavVisible(navItem, (p) => can(p), user?.role);

  return (
    <BreadcrumbProvider>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
            <div className="flex h-14 items-center border-b border-sidebar-border px-4">
              <BrandMark />
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMobileNav={() => setMobileOpen(true)} onOpenCommand={() => setCommandOpen(true)} />
          {mfaEnrollmentRequired && user && !user.mfaEnabled && (
            <div className="flex items-center gap-2 border-b border-sev-medium/30 bg-sev-medium/10 px-4 py-2 text-xs">
              <AlertTriangle className="size-4 text-sev-medium" />
              <span>Multi-factor authentication is required for your role. Set it up to continue using the console.</span>
              <Link href="/settings?tab=security&enroll=1" className="ml-auto font-medium text-primary hover:underline">
                Set up MFA
              </Link>
            </div>
          )}
          <main id="main" className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
            {permitted ? children : <Forbidden />}
          </main>
        </div>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </div>
    </BreadcrumbProvider>
  );
}
