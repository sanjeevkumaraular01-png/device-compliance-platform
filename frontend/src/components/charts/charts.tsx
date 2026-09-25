"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const axisProps = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  tickLine: false,
  axisLine: false,
} as const;

/** Themed tooltip used by every chart. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatLabel: labelFormatter,
  formatValue: valueFormatter,
}: {
  active?: boolean;
  formatLabel?: (label: string) => string;
  formatValue?: (v: number, name: string) => string;
  // injected by recharts at runtime
  payload?: readonly { name?: string | number; value?: unknown; color?: string; payload?: Record<string, unknown>; dataKey?: unknown }[];
  label?: unknown;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-[140px] rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg">
      {label !== undefined && label !== "" && (
        <div className="mb-1 font-medium">{labelFormatter ? labelFormatter(String(label)) : String(label)}</div>
      )}
      <div className="grid gap-1">
        {payload.map((p, i) => {
          const color = (p.payload?.fill as string) || p.color;
          return (
            <div key={`${String(p.dataKey ?? p.name)}-${i}`} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
              <span className="text-muted-foreground">{p.name}</span>
              <span className="ml-auto font-medium tabular">
                {valueFormatter ? valueFormatter(Number(p.value), String(p.name)) : formatNumber(Number(p.value), 1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export function AreaTrendChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 240,
  yDomain,
  xFormatter,
  valueFormatter,
  className,
}: {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  height?: number;
  yDomain?: [number | "auto", number | "auto"];
  xFormatter?: (v: string) => string;
  valueFormatter?: (v: number, name: string) => string;
  className?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={xKey as string} {...axisProps} tickFormatter={xFormatter} minTickGap={24} />
          <YAxis {...axisProps} domain={yDomain ?? [0, "auto"]} width={44} />
          <Tooltip content={<ChartTooltip formatLabel={xFormatter} formatValue={valueFormatter} />} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#g-${id}-${s.key})`}
              dot={false}
              activeDot={{ r: 3.5 }}
            />
          ))}
          {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleLineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 200,
  xFormatter,
  yDomain,
}: {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  height?: number;
  xFormatter?: (v: string) => string;
  yDomain?: [number | "auto", number | "auto"];
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={xKey as string} {...axisProps} tickFormatter={xFormatter} minTickGap={24} />
          <YAxis {...axisProps} domain={yDomain ?? [0, "auto"]} width={44} />
          <Tooltip content={<ChartTooltip formatLabel={xFormatter} />} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutDatum {
  name: string;
  value: number;
  color: string;
}

export function DonutChart({
  data,
  height = 200,
  centerLabel,
  centerValue,
  showLegend = true,
  className,
}: {
  data: DonutDatum[];
  height?: number;
  centerLabel?: string;
  centerValue?: React.ReactNode;
  showLegend?: boolean;
  className?: string;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const shown = total > 0 ? data : [{ name: "No data", value: 1, color: "var(--muted)" }];
  return (
    <div className={cn("flex flex-col items-center gap-3 sm:flex-row", className)}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="96%"
              paddingAngle={total > 0 && data.filter((d) => d.value > 0).length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {shown.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            {total > 0 && <Tooltip content={<ChartTooltip />} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xl font-semibold tabular">{centerValue ?? formatNumber(total)}</div>
            {centerLabel && <div className="text-[11px] text-muted-foreground">{centerLabel}</div>}
          </div>
        </div>
      </div>
      {showLegend && (
        <ul className="grid w-full min-w-0 gap-1.5 text-xs">
          {data.map((d) => (
            <li key={d.name} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: d.color }} />
              <span className="truncate text-muted-foreground">{d.name}</span>
              <span className="ml-auto font-medium tabular">{formatNumber(d.value)}</span>
              <span className="w-10 text-right text-muted-foreground tabular">{total ? `${Math.round((d.value / total) * 100)}%` : "–"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SimpleBarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 220,
  layout = "horizontal",
  stacked = false,
  colorByDatum,
  xFormatter,
  showLegend,
  barSize,
  yWidth = 44,
}: {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  height?: number;
  /** "vertical" = horizontal bars (categories on Y axis). */
  layout?: "horizontal" | "vertical";
  stacked?: boolean;
  colorByDatum?: (d: T) => string;
  xFormatter?: (v: string) => string;
  showLegend?: boolean;
  barSize?: number;
  yWidth?: number;
}) {
  const vertical = layout === "vertical";
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, bottom: 0, left: vertical ? 0 : -18 }} barCategoryGap="22%">
          <CartesianGrid vertical={vertical} horizontal={!vertical} strokeDasharray="3 3" />
          {vertical ? (
            <>
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey={xKey as string} {...axisProps} width={yWidth} tickFormatter={xFormatter} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey as string} {...axisProps} tickFormatter={xFormatter} minTickGap={8} />
              <YAxis {...axisProps} allowDecimals={false} width={44} />
            </>
          )}
          <Tooltip content={<ChartTooltip formatLabel={xFormatter} />} />
          {series.map((s, idx) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? "a" : undefined}
              radius={stacked ? (idx === series.length - 1 ? (vertical ? [0, 3, 3, 0] : [3, 3, 0, 0]) : 0) : vertical ? [0, 3, 3, 0] : [3, 3, 0, 0]}
              maxBarSize={barSize ?? 36}
            >
              {colorByDatum && data.map((d, i) => <Cell key={i} fill={colorByDatum(d)} />)}
            </Bar>
          ))}
          {(showLegend ?? series.length > 1) && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny inline sparkline (no axes). */
export function Sparkline({ values, color = "var(--chart-1)", height = 32, width = 120 }: { values: number[]; color?: string; height?: number; width?: number }) {
  if (values.length < 2) return <div style={{ height, width }} className="text-[10px] text-muted-foreground">Not enough data</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
