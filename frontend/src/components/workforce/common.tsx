"use client";

import * as React from "react";
import Link from "next/link";
import { format, isValid, parseISO } from "date-fns";
import { Building2, Globe, House, MonitorSmartphone, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FilterSelect } from "@/components/data-table/filters";
import { useDepartments } from "@/hooks/use-lookups";
import { cn, initials } from "@/lib/utils";
import {
  attendanceMeta,
  categoryMeta,
  liveStatusMeta,
  locationMeta,
  productiveTone,
  toneDot,
  toneText,
  type Tone,
} from "@/lib/status";
import type { ActivityCategory, AppRuleKind, AttendanceStatus, LiveStatus, WorkLocation } from "@/types/api";

// ─────────────────────────────── Date / time helpers ───────────────────────────────

/** Local calendar date (browser) as yyyy-MM-dd. */
export function todayLocal(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function currentMonth(): string {
  return format(new Date(), "yyyy-MM");
}

export function shiftDate(date: string, days: number): string {
  const d = parseISO(date);
  if (!isValid(d)) return date;
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
}

/** "HH:mm" for an ISO timestamp, "—" when missing. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  return isValid(d) ? format(d, "HH:mm") : "—";
}

/** Human date for a yyyy-MM-dd (or ISO) value. */
export function fmtDay(value: string | null | undefined, pattern = "EEE, MMM d"): string {
  if (!value) return "—";
  const d = parseISO(value.length === 10 ? `${value}T00:00:00` : value);
  return isValid(d) ? format(d, pattern) : value;
}

/** Seconds → "3h 12m" / "45m" / "0m". */
export function fmtHm(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return "—";
  const total = Math.max(0, Math.round(sec / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Minutes → "3h 12m". */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  return fmtHm(min * 60);
}

/** Decimal hours → "7.5 h". */
export function fmtHours(h: number | null | undefined, digits = 1): string {
  if (h === null || h === undefined || Number.isNaN(h)) return "—";
  return `${(Math.round(h * 10 ** digits) / 10 ** digits).toString()} h`;
}

/** Live-ticking seconds since an ISO start (for running timers). */
export function useElapsed(startIso: string | null | undefined): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!startIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startIso]);
  if (!startIso) return 0;
  const start = Date.parse(startIso);
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
}

/** Seconds → "01:02:03". */
export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// ─────────────────────────────── Badges ───────────────────────────────

export function CategoryBadge({ value, className }: { value: ActivityCategory | null | undefined; className?: string }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const m = categoryMeta[value] ?? categoryMeta.UNCATEGORIZED;
  return (
    <Badge tone={m.tone} dot className={className}>
      {m.label}
    </Badge>
  );
}

export function LiveStatusDot({ status, className }: { status: LiveStatus; className?: string }) {
  const m = liveStatusMeta[status] ?? liveStatusMeta.OFFLINE;
  const pulse = status === "ONLINE_ACTIVE";
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-50", toneDot[m.tone])} />}
      <span className={cn("relative inline-flex size-2 rounded-full", toneDot[m.tone])} />
    </span>
  );
}

export function LiveStatusBadge({ status, className }: { status: LiveStatus; className?: string }) {
  const m = liveStatusMeta[status] ?? liveStatusMeta.OFFLINE;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", toneText[m.tone], className)}>
      <LiveStatusDot status={status} />
      {m.label}
    </span>
  );
}

const locationIcon: Record<WorkLocation, React.ComponentType<{ className?: string }>> = {
  OFFICE: Building2,
  REMOTE: House,
  UNKNOWN: Globe,
};

export function LocationBadge({ value, className }: { value: WorkLocation | null | undefined; className?: string }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const m = locationMeta[value] ?? locationMeta.UNKNOWN;
  const Icon = locationIcon[value] ?? Globe;
  return (
    <Badge tone={m.tone} className={className}>
      <Icon />
      {m.label}
    </Badge>
  );
}

export function AttendanceBadge({ value, className }: { value: AttendanceStatus | null | undefined; className?: string }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const m = attendanceMeta[value];
  return (
    <Badge tone={m?.tone ?? "unknown"} dot className={className}>
      {m?.label ?? value}
    </Badge>
  );
}

export function LateBadge({ minutes }: { minutes: number | null | undefined }) {
  if (!minutes || minutes <= 0) return null;
  return (
    <Badge tone="medium" title={`${minutes} minutes late`}>
      Late {fmtMinutes(minutes)}
    </Badge>
  );
}

export function KindIcon({ kind, className }: { kind: AppRuleKind; className?: string }) {
  const Icon = kind === "WEBSITE" ? Globe : MonitorSmartphone;
  return (
    <span title={kind === "WEBSITE" ? "Website" : "Application"} className="inline-flex">
      <Icon className={cn("size-3.5 text-muted-foreground", className)} aria-hidden />
      <span className="sr-only">{kind === "WEBSITE" ? "Website" : "Application"}</span>
    </span>
  );
}

/** Marks content produced by Claude so it is never mistaken for a human assessment. */
export function AiGeneratedBadge({ model, className }: { model?: string | null; className?: string }) {
  return (
    <Badge tone="primary" className={className} title={model ? `Generated by ${model}` : "AI-generated"}>
      <Sparkles /> AI-generated{model ? ` · ${model}` : ""}
    </Badge>
  );
}

// ─────────────────────────────── Cells ───────────────────────────────

export function PersonCell({
  name,
  sub,
  href,
  className,
  size = "sm",
}: {
  name: string;
  sub?: React.ReactNode;
  href?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const body = (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar className={size === "md" ? "size-9" : "size-7"}>
        <AvatarFallback className={size === "md" ? "text-xs" : "text-[10px]"}>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium">{name}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </span>
  );
  if (!href) return body;
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="block min-w-0 rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  );
}

/** Small percent bar with numeric label; tone derived from the value unless given. */
export function PercentBar({
  value,
  tone,
  className,
  label,
  showValue = true,
}: {
  value: number | null | undefined;
  tone?: Tone;
  className?: string;
  label?: string;
  showValue?: boolean;
}) {
  const v = value === null || value === undefined || Number.isNaN(value) ? null : Math.max(0, Math.min(100, value));
  const t = tone ?? productiveTone(v);
  return (
    <div className={cn("flex min-w-[88px] items-center gap-2", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v ?? 0}
        aria-label={label ?? "Percentage"}
      >
        {v !== null && <div className={cn("h-full rounded-full", toneDot[t])} style={{ width: `${v}%` }} />}
      </div>
      {showValue && <span className={cn("w-9 text-right text-xs font-medium tabular", toneText[t])}>{v === null ? "—" : `${Math.round(v)}%`}</span>}
    </div>
  );
}

// ─────────────────────────────── Filters ───────────────────────────────

export function DepartmentFilter({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const deps = useDepartments();
  if (!deps.data || deps.data.length === 0) return null;
  return (
    <FilterSelect
      label="Department"
      value={value}
      onChange={onChange}
      options={deps.data.map((d) => ({ value: d.id, label: d.name }))}
    />
  );
}

export function DateInput({
  value,
  onChange,
  label = "Date",
  className,
  max,
  type = "date",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  className?: string;
  max?: string;
  type?: "date" | "month";
}) {
  return (
    <Input
      type={type}
      aria-label={label}
      value={value}
      max={max}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className={cn("h-8 w-[150px] px-2 text-xs", className)}
    />
  );
}

/** Compact metric tile used inside cards (label over value). */
export function Metric({ label, value, sub, tone, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-muted/30 px-3 py-2", className)}>
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-base font-semibold tabular", tone && toneText[tone])}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
