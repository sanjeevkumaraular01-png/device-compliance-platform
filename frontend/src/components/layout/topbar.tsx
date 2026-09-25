"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, KeyRound, LogOut, Menu, MonitorSmartphone, Search, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { RunningTimerIndicator } from "@/components/workforce/task-timer";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { initials } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { DashboardSummary } from "@/types/api";

function AlertsBell() {
  const { can } = useAuth();
  const enabled = can("dashboard:read");
  const { data } = useQuery({
    queryKey: ["dashboard", "summary", undefined],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    enabled,
    refetchInterval: 60_000,
  });
  const open = data?.openAlerts;
  const total = open?.total ?? 0;
  const canAlerts = can("alerts:read");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Open alerts: ${total}`}>
          <Bell />
          {total > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Open alerts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {open ? (
          <div className="grid grid-cols-3 gap-2 px-2 py-2 text-center">
            <div>
              <div className="text-lg font-semibold tabular">{formatNumber(open.total)}</div>
              <div className="text-[11px] text-muted-foreground">Total</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-sev-critical tabular">{formatNumber(open.critical)}</div>
              <div className="text-[11px] text-muted-foreground">Critical</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-sev-high tabular">{formatNumber(open.high)}</div>
              <div className="text-[11px] text-muted-foreground">High</div>
            </div>
          </div>
        ) : (
          <div className="px-2 py-3 text-xs text-muted-foreground">Alert counts unavailable.</div>
        )}
        {canAlerts && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/alerts">
                <Bell /> View all alerts
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md p-1 pr-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          <Avatar className="size-7">
            <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 leading-tight md:block">
            <div className="max-w-[140px] truncate text-xs font-medium">{user.displayName}</div>
            <div className="max-w-[140px] truncate text-[10px] text-muted-foreground">{user.roleName}</div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium text-foreground">{user.displayName}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge tone="primary">{user.roleName}</Badge>
            {user.mfaEnabled ? <Badge tone="success">MFA on</Badge> : <Badge tone="medium">MFA off</Badge>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=profile">
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=security">
            <ShieldCheck /> Security & MFA
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=sessions">
            <MonitorSmartphone /> Active sessions
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=security#password">
            <KeyRound /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenMobileNav, onOpenCommand }: { onOpenMobileNav: () => void; onOpenCommand: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu />
      </Button>
      <div className="hidden min-w-0 flex-1 sm:block">
        <Breadcrumbs />
      </div>
      <div className="flex-1 sm:hidden" />
      <button
        type="button"
        onClick={onOpenCommand}
        className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-xs text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-64"
        aria-label="Open search (Ctrl+K)"
      >
        <Search className="size-3.5" />
        <span className="hidden md:inline">Search devices, pages…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] md:inline">⌘K</kbd>
      </button>
      <RunningTimerIndicator />
      <AlertsBell />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
