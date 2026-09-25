"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, HardDrive, KeyRound, LockKeyhole, Radar, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { DonutChart, SimpleBarChart } from "@/components/charts/charts";
import { ErrorState } from "@/components/common/states";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { formatNumber, formatPercent, pct } from "@/lib/format";
import { protectionMeta, rateTone, toneColor, toneDot, toneText, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { PROTECTION_STATES, type ProtectionState, type SecurityOverview, type StateCount } from "@/types/api";

export type SecurityFilterKey = "antivirusState" | "edrState" | "firewallState" | "diskEncryptionState";

interface Segment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  /** Protection state this segment maps to (used for bar chart + filtering). */
  state: ProtectionState;
}

interface ProtectionDef {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  enabledLabel: string;
  filterKey?: SecurityFilterKey;
  segments: Segment[];
}

function fromStateCounts(rows: StateCount[] | undefined): Segment[] {
  return PROTECTION_STATES.map((state) => ({
    key: state,
    state,
    label: protectionMeta[state].label,
    tone: protectionMeta[state].tone,
    value: rows?.find((r) => r.state === state)?.count ?? 0,
  }));
}

function buildDefs(o: SecurityOverview): ProtectionDef[] {
  return [
    { id: "antivirus", title: "Antivirus", icon: ShieldCheck, enabledLabel: "protected", filterKey: "antivirusState", segments: fromStateCounts(o.antivirus) },
    { id: "edr", title: "EDR", icon: Radar, enabledLabel: "protected", filterKey: "edrState", segments: fromStateCounts(o.edr) },
    { id: "firewall", title: "Firewall", icon: Flame, enabledLabel: "enabled", filterKey: "firewallState", segments: fromStateCounts(o.firewall) },
    {
      id: "diskEncryption",
      title: "Disk encryption",
      icon: HardDrive,
      enabledLabel: "encrypted",
      filterKey: "diskEncryptionState",
      segments: fromStateCounts(o.diskEncryption),
    },
    { id: "secureBoot", title: "Secure Boot", icon: KeyRound, enabledLabel: "enabled", segments: fromStateCounts(o.secureBoot) },
    {
      id: "screenLock",
      title: "Screen lock",
      icon: LockKeyhole,
      enabledLabel: "compliant",
      segments: [
        { key: "compliant", state: "ENABLED", label: "Compliant", tone: "success", value: o.screenLock?.compliant ?? 0 },
        { key: "nonCompliant", state: "DISABLED", label: "Non-compliant", tone: "critical", value: o.screenLock?.nonCompliant ?? 0 },
        { key: "unknown", state: "UNKNOWN", label: "Unknown", tone: "unknown", value: o.screenLock?.unknown ?? 0 },
      ],
    },
  ];
}

function ProtectionCard({
  def,
  activeState,
  onSelect,
}: {
  def: ProtectionDef;
  activeState?: string;
  onSelect?: (key: SecurityFilterKey, state: ProtectionState | undefined) => void;
}) {
  const total = def.segments.reduce((a, s) => a + s.value, 0);
  const enabled = def.segments.find((s) => s.state === "ENABLED")?.value ?? 0;
  const rate = pct(enabled, total);
  const tone = total ? rateTone(rate) : "unknown";
  const Icon = def.icon;
  const shown = def.segments.filter((s) => s.value > 0 || s.state === "ENABLED");
  const clickable = !!(def.filterKey && onSelect);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-3.5" />
          </span>
          <h3 className="truncate text-sm font-semibold">{def.title}</h3>
        </div>
        <div className="text-right">
          <div className={cn("text-2xl font-semibold leading-none tabular", toneText[tone])}>{total ? formatPercent(rate) : "—"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {formatNumber(enabled)} / {formatNumber(total)} {def.enabledLabel}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-4">
        <DonutChart
          height={92}
          showLegend={false}
          centerValue={<span className="text-sm">{formatNumber(total)}</span>}
          data={def.segments.map((s) => ({ name: s.label, value: s.value, color: toneColor[s.tone] }))}
        />
        <ul className="grid min-w-0 flex-1 gap-0.5 text-xs">
          {shown.map((s) => {
            const active = clickable && activeState === s.state;
            const content = (
              <>
                <span className={cn("size-2 shrink-0 rounded-[3px]", toneDot[s.tone])} aria-hidden />
                <span className="truncate text-muted-foreground">{s.label}</span>
                <span className="ml-auto font-medium tabular">{formatNumber(s.value)}</span>
              </>
            );
            return (
              <li key={s.key}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onSelect?.(def.filterKey as SecurityFilterKey, active ? undefined : s.state)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                    )}
                    aria-pressed={active}
                    title={`Show devices where ${def.title} is ${s.label.toLowerCase()}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-1.5 py-1">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

export function ProtectionOverview({
  filters,
  onSelect,
}: {
  filters: Partial<Record<SecurityFilterKey, string | undefined>>;
  onSelect: (key: SecurityFilterKey, state: ProtectionState | undefined) => void;
}) {
  const q = useQuery({
    queryKey: ["security", "overview"],
    queryFn: () => api.get<SecurityOverview>("/security/overview"),
    refetchInterval: 60_000,
  });

  const defs = React.useMemo(() => (q.data ? buildDefs(q.data) : []), [q.data]);
  const chartData = React.useMemo(
    () =>
      defs.map((d) => {
        const row: Record<string, string | number> = { name: d.title };
        for (const st of PROTECTION_STATES) row[st] = 0;
        for (const s of d.segments) row[s.state] = (Number(row[s.state]) || 0) + s.value;
        return row;
      }),
    [defs],
  );

  if (q.isLoading) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-lg" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card>
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} title="Could not load security posture" />
      </Card>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {defs.map((d) => (
          <ProtectionCard key={d.id} def={d} activeState={d.filterKey ? filters[d.filterKey] : undefined} onSelect={onSelect} />
        ))}
      </div>
      <WidgetCard
        title="Protection comparison"
        description="Device count per protection state. Screen lock: compliant is shown as enabled, non-compliant as disabled."
      >
        <SimpleBarChart
          data={chartData}
          xKey="name"
          layout="vertical"
          stacked
          height={280}
          yWidth={104}
          barSize={22}
          series={PROTECTION_STATES.map((st) => ({ key: st, label: protectionMeta[st].label, color: toneColor[protectionMeta[st].tone] }))}
        />
      </WidgetCard>
    </div>
  );
}
