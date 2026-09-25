"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, ChevronLeft, ChevronRight, ExternalLink, UserSearch } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPicker } from "@/components/users/user-picker";
import { useAuth } from "@/lib/auth";
import { DateInput, fmtDay, shiftDate, todayLocal } from "@/components/workforce/common";
import { ScreenshotAuditNote, ScreenshotGallery } from "@/components/workforce/screenshot-gallery";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_HELP =
  "No screenshots for this employee on this day. Screenshots are off by default and only captured when the employee's workforce policy enables them (Workforce Settings → Policies → Screenshots), while the employee is active during tracked hours.";

export default function WorkforceScreenshotsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ScreenshotsInner />
    </React.Suspense>
  );
}

function ScreenshotsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, can } = useAuth();
  const today = todayLocal();

  const rawDate = searchParams.get("date");
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : today;
  const userId = searchParams.get("userId") || undefined;
  const [userName, setUserName] = React.useState<string | undefined>(undefined);

  const update = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (p.get("date") === today) p.delete("date");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setDate = (d: string) => update({ date: d });

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <PageHeader
        title="Screenshots"
        icon={Camera}
        description="Periodic screenshots captured by the agent for employees whose workforce policy enables them."
        className="mb-0"
      />

      <div className="flex items-start gap-2 rounded-md border border-sev-medium/30 bg-sev-medium/10 px-3 py-2">
        <ScreenshotAuditNote className="text-xs text-foreground [&_svg]:text-sev-medium" />
      </div>

      <Card className="min-w-0">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="grid grid-cols-1 w-full min-w-0 gap-1.5 sm:w-auto sm:min-w-64 sm:max-w-sm sm:flex-1">
            <Label htmlFor="shots-user">Employee</Label>
            <UserPicker
              id="shots-user"
              value={userId}
              onChange={(id, u) => {
                setUserName(u?.displayName);
                update({ userId: id });
              }}
              selectedLabel={userName}
              placeholder="Select an employee…"
              size="sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <span className="text-sm font-medium" id="shots-date-label">
              Date
            </span>
            <div className="flex items-center gap-1" role="group" aria-labelledby="shots-date-label">
              <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
                <ChevronLeft />
              </Button>
              <DateInput value={date} onChange={setDate} max={today} label="Screenshot date" />
              <Button variant="outline" size="icon-sm" aria-label="Next day" disabled={date >= today} onClick={() => setDate(shiftDate(date, 1))}>
                <ChevronRight />
              </Button>
              {date !== today && (
                <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
                  Today
                </Button>
              )}
            </div>
          </div>
          {userId && can("workforce:read") && (
            <Button asChild variant="outline" size="sm" className="sm:ml-auto">
              <Link href={`/workforce/people/${userId}?date=${date}`}>
                <ExternalLink /> Employee day
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {!userId ? (
        <Card>
          <EmptyState
            icon={UserSearch}
            title="Select an employee"
            description="Pick an employee and a date to review their screenshots. Opening a screenshot is recorded in the audit log."
          />
        </Card>
      ) : (
        <Card className="min-w-0">
          <CardContent className="grid grid-cols-1 gap-3 p-3">
            <div className="text-xs text-muted-foreground">
              {userName ? <span className="font-medium text-foreground">{userName}</span> : "Selected employee"} · {fmtDay(date, "EEEE, MMM d, yyyy")}
            </div>
            <ScreenshotGallery key={`${userId}:${date}`} userId={userId} date={date} canDelete={user?.role === "SUPER_ADMIN"} emptyDescription={EMPTY_HELP} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
