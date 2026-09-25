"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Lock, MessageSquareWarning, Plus, Save, Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/common/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/common/states";
import { DateInput, fmtDay, fmtMinutes, shiftDate, todayLocal } from "@/components/workforce/common";
import { useMyTasks } from "@/components/workforce/queries";
import { AutoDraftContext, ReportItemView, ReportStatusBadge } from "@/components/workforce/reports/report-view";
import { blankItem, isBlank, ReportItemCard, toDraft, toInput, type ItemDraft } from "@/components/workforce/reports/report-item-card";
import {
  emptyErrors,
  errorCount,
  parseReportApiError,
  prettifyMessage,
  validateItems,
  type ReportErrors,
} from "@/components/workforce/reports/report-validation";
import { isOpenTask } from "@/components/workforce/tasks/task-cells";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { DailyReportItemInput, DailyWorkReport, TaskStatus } from "@/types/api";

export const REPORT_KEYS = {
  mine: (date: string) => ["daily-reports", "me", date] as const,
};

const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function MyReportTab({ initialDate, onDateChange }: { initialDate?: string | null; onDateChange?: (date: string) => void }) {
  const today = todayLocal();
  const [date, setDateState] = React.useState(() => (isDate(initialDate) && initialDate <= today ? initialDate : today));
  const setDate = (d: string) => {
    const next = d > today ? today : d;
    setDateState(next);
    onDateChange?.(next);
  };

  const q = useQuery({
    queryKey: REPORT_KEYS.mine(date),
    queryFn: () => api.get<DailyWorkReport>(`/daily-reports/me/${date}`),
  });

  return (
    <div className="grid grid-cols-1 min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
            <ChevronLeft />
          </Button>
          <DateInput value={date} onChange={setDate} max={today} label="Report date" />
          <Button variant="outline" size="icon-sm" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} aria-label="Next day">
            <ChevronRight />
          </Button>
        </div>
        {date !== today && (
          <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
            Today
          </Button>
        )}
        <span className="text-sm font-medium">{fmtDay(date, "EEEE, MMMM d, yyyy")}</span>
        {q.data && <ReportStatusBadge value={q.data.status} />}
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : q.data ? (
        <ReportEditor key={date} date={date} report={q.data} />
      ) : null}
    </div>
  );
}

function ReportEditor({ date, report }: { date: string; report: DailyWorkReport }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const myTasks = useMyTasks();
  const readOnly = report.status === "SUBMITTED" || report.status === "APPROVED";

  const [summary, setSummary] = React.useState(report.summary ?? "");
  const [items, setItems] = React.useState<ItemDraft[]>(() => (Array.isArray(report.items) ? [...report.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(toDraft) : []));
  const [dirty, setDirty] = React.useState(false);
  const [showClientErrors, setShowClientErrors] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<ReportErrors>(emptyErrors);
  const [busy, setBusy] = React.useState<"save" | "submit" | null>(null);

  const allMine = React.useMemo(() => myTasks.data ?? [], [myTasks.data]);
  const openTasks = React.useMemo(() => allMine.filter((t) => isOpenTask(t.status)), [allMine]);
  const statusOf = React.useCallback(
    (taskId: string): TaskStatus | undefined => allMine.find((t) => t.id === taskId)?.status ?? items.find((i) => i.taskId === taskId)?.linkedStatus ?? undefined,
    [allMine, items],
  );
  // Tasks offered in the picker: open ones + any already linked (even if closed since).
  const pickable = React.useMemo(() => {
    const ids = new Set(openTasks.map((t) => t.id));
    return [...openTasks, ...allMine.filter((t) => !ids.has(t.id) && items.some((i) => i.taskId === t.id))];
  }, [openTasks, allMine, items]);

  const clientErrors = React.useMemo(() => validateItems(items, statusOf), [items, statusOf]);
  const errorsFor = (index: number) => {
    const c = showClientErrors ? clientErrors.items[index] : undefined;
    const s = serverErrors.items[index];
    if (!c) return s;
    if (!s) return c;
    const merged: typeof c = { ...c };
    for (const [k, v] of Object.entries(s) as [keyof typeof c, string[]][]) merged[k] = [...(merged[k] ?? []), ...v.filter((m) => !(merged[k] ?? []).includes(m))];
    return merged;
  };
  const topErrors = [...(showClientErrors ? clientErrors.top : []), ...serverErrors.top];

  const mutateItems = (fn: (prev: ItemDraft[]) => ItemDraft[], clearIndex?: number) => {
    setItems(fn);
    setDirty(true);
    if (clearIndex !== undefined) {
      setServerErrors((e) => {
        if (!e.items[clearIndex]) return e;
        const rest = { ...e.items };
        delete rest[clearIndex];
        return { ...e, items: rest };
      });
    } else {
      // Structural change (add/remove/reorder): server messages no longer line up with indexes.
      setServerErrors((e) => ({ top: e.top, items: {} }));
    }
  };
  const update = (index: number, patch: Partial<ItemDraft>) => mutateItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)), index);
  const remove = async (index: number) => {
    if (!isBlank(items[index])) {
      const ok = await confirm({ title: `Remove item ${index + 1}?`, description: "Its content will be discarded when you save.", confirmLabel: "Remove", destructive: true });
      if (!ok) return;
    }
    mutateItems((prev) => prev.filter((_, i) => i !== index));
  };
  const move = (index: number, dir: -1 | 1) =>
    mutateItems((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const suggested: DailyReportItemInput[] = Array.isArray(report.autoDraft?.suggestedItems) ? report.autoDraft.suggestedItems : [];
  const [fillAsk, setFillAsk] = React.useState(false);
  const applySuggestions = (mode: "append" | "replace") => {
    const drafts = suggested.map((s) => toDraft(s));
    mutateItems((prev) => (mode === "replace" ? drafts : [...prev.filter((i) => !isBlank(i)), ...drafts]));
    setFillAsk(false);
    toast.success(`${drafts.length} suggested item${drafts.length === 1 ? "" : "s"} ${mode === "replace" ? "loaded" : "appended"} — review and complete them`);
  };
  const fillFromActivity = () => {
    if (suggested.length === 0) return;
    if (items.some((i) => !isBlank(i))) setFillAsk(true);
    else applySuggestions("replace");
  };

  const payload = () => ({ summary: summary.trim() || null, items: items.map(toInput) });
  const invalidate = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["daily-reports"] }), qc.invalidateQueries({ queryKey: ["workforce"] })]);

  const saveDraft = async () => {
    setBusy("save");
    try {
      const saved = await api.put<DailyWorkReport>(`/daily-reports/me/${date}`, payload());
      if (saved && typeof saved === "object") qc.setQueryData(REPORT_KEYS.mine(date), saved);
      setDirty(false);
      toast.success("Draft saved");
      void invalidate();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 400)) setServerErrors(parseReportApiError(err, items.length));
      toast.error("Could not save the draft", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setShowClientErrors(true);
    setServerErrors(emptyErrors());
    const n = errorCount(clientErrors);
    if (n > 0) {
      toast.error(`Fix ${n} issue${n === 1 ? "" : "s"} before submitting`);
      return;
    }
    setBusy("submit");
    try {
      await api.put<DailyWorkReport>(`/daily-reports/me/${date}`, payload());
      setDirty(false);
      const submitted = await api.post<DailyWorkReport>(`/daily-reports/me/${date}/submit`);
      if (submitted && typeof submitted === "object") qc.setQueryData(REPORT_KEYS.mine(date), submitted);
      toast.success("Report submitted", { description: "Your manager can now review it." });
      void invalidate();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 400)) {
        const parsed = parseReportApiError(err, items.length);
        setServerErrors(parsed);
        const c = errorCount(parsed);
        toast.error("The report was not accepted", { description: `${c} issue${c === 1 ? "" : "s"} to fix — see the highlighted fields.` });
        void qc.invalidateQueries({ queryKey: REPORT_KEYS.mine(date) });
      } else {
        toast.error("Could not submit the report", { description: errorMessage(err) });
      }
    } finally {
      setBusy(null);
    }
  };

  const totalMinutes = items.reduce((n, i) => n + (/^\d+$/.test(i.minutes.trim()) ? Number(i.minutes) : 0), 0);

  return (
    <div className="grid grid-cols-1 min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid grid-cols-1 min-w-0 content-start gap-3">
        {report.status === "CHANGES_REQUESTED" && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-sev-medium/40 bg-sev-medium/10 px-3 py-2.5 text-sm">
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-sev-medium" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">
                Changes requested{report.reviewer?.displayName ? ` by ${report.reviewer.displayName}` : ""}
                {report.reviewedAt && <span className="font-normal text-muted-foreground"> · {formatDateTime(report.reviewedAt)}</span>}
              </p>
              {report.reviewNote && <p className="mt-0.5 whitespace-pre-wrap break-words">{report.reviewNote}</p>}
              <p className="mt-1 text-xs text-muted-foreground">Update the items below and submit again.</p>
            </div>
          </div>
        )}

        {readOnly && (
          <div role="status" className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            {report.status === "APPROVED" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sev-none" aria-hidden />
            ) : (
              <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {report.status === "APPROVED" ? "Approved" : "Submitted"}
                {report.submittedAt && <span className="font-normal text-muted-foreground"> · submitted {formatDateTime(report.submittedAt)}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {report.status === "APPROVED"
                  ? `Reviewed${report.reviewer?.displayName ? ` by ${report.reviewer.displayName}` : ""}${report.reviewNote ? `: ${report.reviewNote}` : "."}`
                  : "This report is locked while it awaits review. Your manager can request changes."}
              </p>
            </div>
          </div>
        )}

        {!readOnly && report.id === null && (
          <p className="text-xs text-muted-foreground">
            Not saved yet{suggested.length > 0 ? " — items may be pre-filled from your tracked activity; review them before submitting." : "."}
          </p>
        )}

        {topErrors.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" aria-hidden /> Please fix the following
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-6 text-xs">
              {topErrors.map((m, i) => (
                <li key={i}>{prettifyMessage(m)}</li>
              ))}
            </ul>
          </div>
        )}

        <Card>
          <CardContent className="grid grid-cols-1 gap-1.5 p-3">
            <Label htmlFor="report-summary">Summary (optional)</Label>
            {readOnly ? (
              <p id="report-summary" className="whitespace-pre-wrap break-words text-sm">
                {report.summary || <span className="text-muted-foreground">No summary.</span>}
              </p>
            ) : (
              <Textarea
                id="report-summary"
                rows={2}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setDirty(true);
                }}
                placeholder="One or two lines about the day — highlights, anything your manager should know."
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Work items <span className="font-normal text-muted-foreground">({items.length}{totalMinutes > 0 ? ` · ${fmtMinutes(totalMinutes)}` : ""})</span>
          </h2>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fillFromActivity()} disabled={suggested.length === 0} title={suggested.length === 0 ? "No tracked activity to suggest from" : undefined}>
                <Wand2 /> Fill from tracked activity
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => mutateItems((p) => [...p, blankItem()])}>
                <Plus /> Add item
              </Button>
            </div>
          )}
        </div>

        {readOnly ? (
          report.items?.length ? (
            <div className="grid grid-cols-1 gap-2">
              {report.items.map((it, i) => (
                <ReportItemView key={it.id ?? i} item={it} index={i} taskStatus={it.task?.status} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState compact icon={ClipboardList} title="No items" />
            </Card>
          )
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={ClipboardList}
              title="No work items yet"
              description="Add what you worked on today — one item per task — or start from your tracked activity."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {suggested.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => fillFromActivity()}>
                      <Wand2 /> Fill from tracked activity
                    </Button>
                  )}
                  <Button size="sm" onClick={() => mutateItems((p) => [...p, blankItem()])}>
                    <Plus /> Add item
                  </Button>
                </div>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {items.map((it, i) => (
              <ReportItemCard
                key={it.uid}
                item={it}
                index={i}
                count={items.length}
                tasks={pickable}
                taskStatus={it.taskId ? statusOf(it.taskId) : undefined}
                errors={errorsFor(i)}
                onChange={(patch) => update(i, patch)}
                onRemove={() => void remove(i)}
                onMove={(d) => move(i, d)}
              />
            ))}
          </div>
        )}

        {!readOnly && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <span className="mr-auto text-xs text-muted-foreground">
              {dirty ? "Unsaved changes" : report.updatedAt ? `Saved ${formatDateTime(report.updatedAt)}` : "Not saved yet"}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void saveDraft()} loading={busy === "save"} disabled={busy !== null}>
              {busy !== "save" && <Save />} Save draft
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} loading={busy === "submit"} disabled={busy !== null}>
              {busy !== "submit" && <Send />} Submit report
            </Button>
          </div>
        )}
      </div>

      <aside className="grid grid-cols-1 min-w-0 content-start gap-3">
        <Card>
          <CardContent className="p-3">
            {report.autoDraft ? (
              <AutoDraftContext draft={report.autoDraft} />
            ) : (
              <p className="text-xs text-muted-foreground">No tracked activity for this day.</p>
            )}
          </CardContent>
        </Card>
        {!readOnly && (
          <Card>
            <CardContent className="grid grid-cols-1 gap-1.5 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What makes a good report</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>One item per task or piece of work.</li>
                <li>“Work completed” states the concrete change, not “working on it”.</li>
                <li>“Result” is the outcome: shipped, sent, fixed, decided.</li>
                <li>If a linked task isn’t done, add a blocker or the next action.</li>
              </ul>
            </CardContent>
          </Card>
        )}
      </aside>

      <Dialog open={fillAsk} onOpenChange={setFillAsk}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Use tracked activity?</DialogTitle>
            <DialogDescription>
              You already have {items.filter((i) => !isBlank(i)).length} item(s). Replace them with {suggested.length} suggestion(s) from your tracked activity, or append the
              suggestions after your items?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFillAsk(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => applySuggestions("append")}>
              Append
            </Button>
            <Button type="button" variant="destructive" onClick={() => applySuggestions("replace")}>
              Replace items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
