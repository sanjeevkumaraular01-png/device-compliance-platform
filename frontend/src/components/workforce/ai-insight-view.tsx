"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, ListChecks, ShieldAlert, Sparkles, TrendingDown, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badges";
import { AiGeneratedBadge, fmtMinutes } from "@/components/workforce/common";
import { aiInsightStatusMeta, reportConsistencyMeta, workloadMeta } from "@/lib/status";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AiInsight, EmployeeInsight, ManagementInsight } from "@/types/api";

function Section({ title, icon: Icon, children, className }: { title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-1.5", className)}>
      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="size-3.5" />} {title}
      </h4>
      {children}
    </section>
  );
}

function Bullets({ items, empty = "None" }: { items: string[] | undefined; empty?: string }) {
  if (!items || items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid grid-cols-1 list-disc gap-1 pl-4 text-sm marker:text-muted-foreground">
      {items.map((t, i) => (
        <li key={i} className="break-words">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Footer with model + token usage for transparency. */
export function InsightMeta({ insight }: { insight: AiInsight }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <AiGeneratedBadge model={insight.model} />
      <StatusBadge value={insight.status} meta={aiInsightStatusMeta} />
      {insight.completedAt && <span>Generated {formatDateTime(insight.completedAt)}</span>}
      {(insight.inputTokens ?? 0) > 0 && (
        <span className="tabular">
          {formatNumber(insight.inputTokens)} in · {formatNumber(insight.outputTokens)} out
          {(insight.cacheReadTokens ?? 0) > 0 ? ` · ${formatNumber(insight.cacheReadTokens)} cached` : ""} tokens
        </span>
      )}
    </div>
  );
}

function StatusNotice({ insight }: { insight: AiInsight }) {
  if (insight.status === "READY") return null;
  const text =
    insight.status === "PENDING"
      ? "This insight is still being generated. It usually completes within a few minutes."
      : insight.status === "SKIPPED"
        ? "No insight was generated for this day (no tracked activity or report)."
        : `Generation failed${insight.error ? `: ${insight.error}` : "."}`;
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", insight.status === "FAILED" ? "border-destructive/30 bg-destructive/5" : "bg-muted/40")}>
      <Info className="mt-px size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** Full rendering of the EmployeeInsightSchema. */
export function EmployeeInsightView({ insight, compact = false }: { insight: AiInsight<EmployeeInsight>; compact?: boolean }) {
  const c = (insight.content ?? {}) as Partial<EmployeeInsight>;
  return (
    <div className="grid grid-cols-1 gap-4">
      <StatusNotice insight={insight} />
      {insight.status === "READY" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {c.workload && <StatusBadge value={c.workload} meta={workloadMeta} />}
            {c.reportConsistency?.status && (
              <Badge tone={reportConsistencyMeta[c.reportConsistency.status]?.tone ?? "unknown"}>
                Report: {reportConsistencyMeta[c.reportConsistency.status]?.label ?? c.reportConsistency.status}
              </Badge>
            )}
            {(c.riskFlags?.length ?? 0) > 0 && (
              <Badge tone="high">
                <ShieldAlert /> {c.riskFlags!.length} risk flag{c.riskFlags!.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          {c.summary && <p className="text-sm leading-relaxed">{c.summary}</p>}
          {c.managerNote && (
            <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
              <UserCog className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <span className="font-medium">Manager note: </span>
                {c.managerNote}
              </span>
            </div>
          )}
          <div className={cn("grid gap-4", !compact && "md:grid-cols-2")}>
            <Section title="Accomplishments" icon={CheckCircle2}>
              <Bullets items={c.accomplishments} />
            </Section>
            <Section title="Blockers" icon={AlertTriangle}>
              {c.blockers && c.blockers.length > 0 ? (
                <ul className="grid grid-cols-1 gap-1.5 text-sm">
                  {c.blockers.map((b, i) => (
                    <li key={i} className="rounded-md border px-2.5 py-1.5">
                      <div className="break-words">{b.description}</div>
                      {b.evidence && <div className="mt-0.5 break-words text-xs text-muted-foreground">Evidence: {b.evidence}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">None identified</p>
              )}
            </Section>
          </div>
          {!compact && (
            <>
              <Section title="Workload" icon={ListChecks}>
                <p className="text-sm">{c.workloadReason || "—"}</p>
              </Section>
              <Section title="Report consistency" icon={ListChecks}>
                <Bullets items={c.reportConsistency?.notes} empty="No notes" />
              </Section>
              <Section title="Low-value / repeated work" icon={TrendingDown}>
                {c.nonValueWork && c.nonValueWork.length > 0 ? (
                  <ul className="grid grid-cols-1 gap-1.5 text-sm">
                    {c.nonValueWork.map((n, i) => (
                      <li key={i} className="rounded-md border px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="break-words font-medium">{n.pattern}</span>
                          <span className="text-xs text-muted-foreground tabular">{fmtMinutes(n.minutes)}</span>
                        </div>
                        {n.suggestion && <div className="mt-0.5 break-words text-xs text-muted-foreground">Suggestion: {n.suggestion}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">None identified</p>
                )}
              </Section>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Section title="Process improvements" icon={Lightbulb}>
                  <Bullets items={c.processImprovements} />
                </Section>
                <Section title="Risk flags" icon={ShieldAlert}>
                  <Bullets items={c.riskFlags} />
                </Section>
              </div>
            </>
          )}
        </>
      )}
      <InsightMeta insight={insight} />
    </div>
  );
}

function NameReasonList({ items, reasonKey, empty }: { items: { name: string; [k: string]: string }[] | undefined; reasonKey: string; empty: string }) {
  if (!items || items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid grid-cols-1 gap-1.5 text-sm">
      {items.map((it, i) => (
        <li key={i} className="rounded-md border px-2.5 py-1.5">
          <span className="font-medium">{it.name}</span>
          <span className="text-muted-foreground"> — </span>
          <span className="break-words">{it[reasonKey]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Full rendering of the ManagementInsightSchema. */
export function ManagementInsightView({ insight }: { insight: AiInsight<ManagementInsight> }) {
  const c = (insight.content ?? {}) as Partial<ManagementInsight>;
  return (
    <div className="grid grid-cols-1 gap-4">
      <StatusNotice insight={insight} />
      {insight.status === "READY" && (
        <>
          {c.headline && (
            <h3 className="flex items-start gap-2 text-base font-semibold leading-snug">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /> {c.headline}
            </h3>
          )}
          {c.overview && <p className="text-sm leading-relaxed">{c.overview}</p>}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Highlights" icon={CheckCircle2}>
              <Bullets items={c.highlights} />
            </Section>
            <Section title="Concerns" icon={AlertTriangle}>
              <Bullets items={c.concerns} />
            </Section>
            <Section title="Overloaded" icon={ShieldAlert}>
              <NameReasonList items={c.overloaded} reasonKey="reason" empty="Nobody flagged" />
            </Section>
            <Section title="Under-utilized" icon={TrendingDown}>
              <NameReasonList items={c.underUtilized} reasonKey="reason" empty="Nobody flagged" />
            </Section>
            <Section title="Blockers" icon={AlertTriangle}>
              <NameReasonList items={c.blockers} reasonKey="blocker" empty="No blockers reported" />
            </Section>
            <Section title="Report gaps" icon={ListChecks}>
              <Bullets items={c.reportGaps} />
            </Section>
            <Section title="Process improvements" icon={Lightbulb}>
              <Bullets items={c.processImprovements} />
            </Section>
            <Section title="Recommended actions" icon={ListChecks}>
              <Bullets items={c.recommendedActions} />
            </Section>
          </div>
        </>
      )}
      <InsightMeta insight={insight} />
    </div>
  );
}

/** Standard disclaimer shown next to AI content. */
export function AiDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-muted-foreground", className)}>
      AI-generated by Claude from tracked activity metrics, tasks and daily reports (never screenshots, window titles or keystrokes). It can be
      wrong — verify before acting, and treat idle time neutrally.
    </p>
  );
}
