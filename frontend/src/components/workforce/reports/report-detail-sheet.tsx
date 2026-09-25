"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, MessageSquareWarning } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/common/states";
import { KeyValueGrid } from "@/components/common/misc";
import { fmtDay, fmtMinutes, PersonCell } from "@/components/workforce/common";
import { AutoDraftContext, ReportItemView, ReportStatusBadge } from "@/components/workforce/reports/report-view";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { DailyWorkReport, TeamReportRow } from "@/types/api";

export function reportMinutes(row: Pick<TeamReportRow, "items">): number | null {
  if (!Array.isArray(row.items) || row.items.length === 0) return null;
  const total = row.items.reduce((n, i) => n + (typeof i.minutesSpent === "number" ? i.minutesSpent : 0), 0);
  return total > 0 ? total : null;
}

export function ReportDetailSheet({ row, onOpenChange }: { row: TeamReportRow | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">{row && <DetailBody key={row.id ?? row.user.id} row={row} onClose={() => onOpenChange(false)} />}</SheetContent>
    </Sheet>
  );
}

function DetailBody({ row, onClose }: { row: TeamReportRow; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canReview = can("tasks:manage") && !!row.id && row.status === "SUBMITTED";
  const [mode, setMode] = React.useState<"idle" | "changes">("idle");
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string | null>(null);

  const review = useApiMutation(
    (v: { status: "APPROVED" | "CHANGES_REQUESTED"; note?: string }) => api.post<DailyWorkReport>(`/daily-reports/${row.id}/review`, v),
    {
      success: (_d, v) => (v.status === "APPROVED" ? "Report approved" : "Changes requested — the employee has been notified"),
      errorTitle: "Could not review the report",
      invalidate: [["daily-reports"], ["workforce"]],
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["ai"] });
        onClose();
      },
    },
  );

  const items = Array.isArray(row.items) ? [...row.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [];
  const minutes = reportMinutes(row);
  const peopleHref = `/workforce/people/${row.user.id}?date=${row.date?.slice(0, 10) ?? ""}`;

  const requestChanges = () => {
    if (note.trim().length < 3) {
      setNoteError("Explain what needs to change.");
      return;
    }
    review.mutate({ status: "CHANGES_REQUESTED", note: note.trim() });
  };

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ReportStatusBadge value={row.status} />
          <span className="text-xs text-muted-foreground">{fmtDay(row.date?.slice(0, 10), "EEEE, MMM d, yyyy")}</span>
        </div>
        <SheetTitle className="sr-only">Daily report of {row.user.displayName}</SheetTitle>
        <SheetDescription className="sr-only">Report details and review actions</SheetDescription>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PersonCell name={row.user.displayName} sub={[row.user.jobTitle, row.user.department?.name].filter(Boolean).join(" · ") || row.user.email} size="md" />
          <Button asChild variant="outline" size="xs">
            <Link href={peopleHref}>
              <ExternalLink /> Employee day
            </Link>
          </Button>
        </div>
      </SheetHeader>
      <SheetBody className="grid grid-cols-1 content-start gap-4 pt-4">
        <KeyValueGrid
          cols={3}
          items={[
            { label: "Submitted", value: row.submittedAt ? formatDateTime(row.submittedAt) : null },
            { label: "Items", value: items.length },
            { label: "Reported time", value: minutes !== null ? fmtMinutes(minutes) : null },
            { label: "Reviewer", value: row.reviewer?.displayName ?? null },
            { label: "Reviewed", value: row.reviewedAt ? formatDateTime(row.reviewedAt) : null },
          ]}
        />
        {row.reviewNote && (
          <div className="rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Review note</p>
            <p className="whitespace-pre-wrap break-words">{row.reviewNote}</p>
          </div>
        )}
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</h3>
          <p className="whitespace-pre-wrap break-words text-sm">{row.summary || <span className="text-muted-foreground">No summary.</span>}</p>
        </section>
        <section className="grid grid-cols-1 gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work items</h3>
          {items.length === 0 ? (
            <EmptyState compact title="No items in this report" description={row.status === "DRAFT" ? "The employee has not added items yet." : undefined} />
          ) : (
            items.map((it, i) => <ReportItemView key={it.id ?? i} item={it} index={i} taskStatus={it.task?.status} />)
          )}
        </section>
        {row.autoDraft && <AutoDraftContext draft={row.autoDraft} className="rounded-lg border p-3" />}

        {canReview && mode === "changes" && (
          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="review-note">
              Note to the employee <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="review-note"
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              aria-invalid={!!noteError}
              placeholder="Item 2 needs a concrete result — what was delivered?"
              autoFocus
            />
            {noteError && <p className="text-xs text-destructive">{noteError}</p>}
          </div>
        )}
      </SheetBody>
      {canReview && (
        <SheetFooter>
          {mode === "idle" ? (
            <>
              <Button variant="outline" onClick={() => setMode("changes")} disabled={review.isPending}>
                <MessageSquareWarning /> Request changes
              </Button>
              <Button onClick={() => review.mutate({ status: "APPROVED" })} loading={review.isPending}>
                {!review.isPending && <CheckCircle2 />} Approve
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setMode("idle")} disabled={review.isPending}>
                Cancel
              </Button>
              <Button onClick={requestChanges} loading={review.isPending}>
                Send change request
              </Button>
            </>
          )}
        </SheetFooter>
      )}
    </>
  );
}
