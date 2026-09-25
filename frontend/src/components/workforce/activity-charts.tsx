"use client";

import * as React from "react";
import { format, isValid, parseISO } from "date-fns";
import { Tag } from "lucide-react";
import { DonutChart, SimpleBarChart, type DonutDatum } from "@/components/charts/charts";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryBadge, KindIcon, PercentBar, fmtHm } from "@/components/workforce/common";
import { ACTIVITY_CATEGORIES, type ActivityCategory, type AppUsage, type HourBucket } from "@/types/api";
import { categoryMeta, toneColor } from "@/lib/status";

export const CATEGORY_COLOR: Record<ActivityCategory, string> = {
  PRODUCTIVE: toneColor.success,
  NEUTRAL: toneColor.low,
  UNPRODUCTIVE: toneColor.medium,
  BLOCKED: toneColor.critical,
  UNCATEGORIZED: toneColor.unknown,
};

export const IDLE_COLOR = "color-mix(in oklab, var(--muted-foreground) 45%, transparent)";

const TIMELINE_SERIES = [
  { key: "productive", label: "Productive", color: CATEGORY_COLOR.PRODUCTIVE },
  { key: "neutral", label: "Neutral", color: CATEGORY_COLOR.NEUTRAL },
  { key: "unproductive", label: "Unproductive", color: CATEGORY_COLOR.UNPRODUCTIVE },
  { key: "idle", label: "Idle", color: IDLE_COLOR },
];

function hourLabel(iso: string): string {
  const d = parseISO(iso);
  if (isValid(d)) return format(d, "HH:00");
  // Some backends send "09" / "9"
  const n = Number(iso);
  return Number.isFinite(n) ? `${String(n).padStart(2, "0")}:00` : iso;
}

/**
 * Hour-by-hour stacked activity (minutes): productive / neutral / unproductive / idle.
 * Leading and trailing empty hours are trimmed (keeps 08:00–19:00 at minimum).
 */
export function HourTimelineChart({ buckets, height = 220 }: { buckets: HourBucket[] | null | undefined; height?: number }) {
  const data = React.useMemo(() => {
    const rows = (buckets ?? []).map((b) => ({
      hour: hourLabel(b.hour),
      productive: Math.round((b.productiveSec ?? 0) / 60),
      neutral: Math.round((b.neutralSec ?? 0) / 60),
      unproductive: Math.round((b.unproductiveSec ?? 0) / 60),
      idle: Math.round((b.idleSec ?? 0) / 60),
      topApp: b.topApp,
    }));
    if (rows.length <= 12) return rows;
    const has = (r: (typeof rows)[number]) => r.productive + r.neutral + r.unproductive + r.idle > 0;
    let first = rows.findIndex(has);
    let last = rows.length - 1 - [...rows].reverse().findIndex(has);
    if (first === -1) return rows.slice(8, 20);
    first = Math.min(first, 8);
    last = Math.max(last, 19);
    return rows.slice(Math.max(0, first), Math.min(rows.length, last + 1));
  }, [buckets]);

  const total = data.reduce((a, r) => a + r.productive + r.neutral + r.unproductive + r.idle, 0);
  if (!buckets || buckets.length === 0 || total === 0) {
    return <EmptyState compact icon={Tag} title="No activity recorded" description="Tracked time appears here hour by hour once the agent reports activity." />;
  }
  return (
    <div role="img" aria-label="Hour by hour activity in minutes: productive, neutral, unproductive and idle">
      <SimpleBarChart data={data} xKey="hour" series={TIMELINE_SERIES} stacked height={height} showLegend barSize={22} />
    </div>
  );
}

/** Donut of seconds per category from an AppUsage list (hours in the legend). */
export function CategoryDonut({ apps, height = 170 }: { apps: AppUsage[]; height?: number }) {
  const data: DonutDatum[] = React.useMemo(() => {
    const sums = new Map<ActivityCategory, number>();
    for (const a of apps) sums.set(a.category, (sums.get(a.category) ?? 0) + (a.seconds ?? 0));
    return ACTIVITY_CATEGORIES.map((c) => ({
      name: categoryMeta[c].label,
      value: Math.round(((sums.get(c) ?? 0) / 3600) * 10) / 10,
      color: CATEGORY_COLOR[c],
    }));
  }, [apps]);
  const totalSec = apps.reduce((a, x) => a + (x.seconds ?? 0), 0);
  return <DonutChart data={data} height={height} centerValue={fmtHm(totalSec)} centerLabel="tracked (h in legend)" />;
}

/** App & website usage table with category chips and share bars. */
export function AppUsageTable({
  apps,
  limit,
  onCategorize,
  maxHeight = "24rem",
}: {
  apps: AppUsage[];
  limit?: number;
  onCategorize?: (a: AppUsage) => void;
  maxHeight?: string;
}) {
  const rows = limit ? apps.slice(0, limit) : apps;
  if (rows.length === 0) return <EmptyState compact title="No app or website usage" description="Nothing was tracked for this period." />;
  return (
    <Table containerStyle={{ maxHeight }}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Application / website</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Time</TableHead>
          <TableHead className="w-40">Share</TableHead>
          {onCategorize && <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((a, i) => (
          <TableRow key={`${a.kind}-${a.label}-${i}`}>
            <TableCell className="py-1.5">
              <div className="flex min-w-[160px] items-center gap-2">
                <KindIcon kind={a.kind} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.label}</div>
                  {(a.domain || a.app) && a.label !== (a.domain ?? a.app) && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{a.domain ?? a.app}</div>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell className="py-1.5">
              <CategoryBadge value={a.category} />
            </TableCell>
            <TableCell className="py-1.5 text-right tabular">{fmtHm(a.seconds)}</TableCell>
            <TableCell className="py-1.5">
              <PercentBar value={a.percent} tone="primary" label={`${a.label} share of tracked time`} />
            </TableCell>
            {onCategorize && (
              <TableCell className="py-1.5">
                <Button variant="ghost" size="icon-xs" aria-label={`Categorize ${a.label}`} onClick={() => onCategorize(a)}>
                  <Tag />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Horizontal bars of the top apps (hours) colored by category. */
export function TopAppsChart({ apps, height = 260 }: { apps: { label: string; category: ActivityCategory; seconds: number }[]; height?: number }) {
  const data = apps.slice(0, 10).map((a) => ({ label: a.label, hours: Math.round((a.seconds / 3600) * 10) / 10, category: a.category }));
  if (data.length === 0) return <EmptyState compact title="No app usage yet" description="Top applications and websites appear once activity is reported." />;
  return (
    <SimpleBarChart
      data={data}
      xKey="label"
      layout="vertical"
      series={[{ key: "hours", label: "Hours", color: "var(--chart-1)" }]}
      colorByDatum={(d) => CATEGORY_COLOR[d.category as ActivityCategory] ?? "var(--chart-1)"}
      height={height}
      yWidth={110}
      showLegend={false}
      barSize={14}
    />
  );
}
