"use client";

import * as React from "react";
import { Braces, Minus, Plus, Equal, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/common/misc";
import { cn } from "@/lib/utils";

type Leaf = string | number | boolean | null | Record<string, never> | never[];
type ChangeKind = "added" | "removed" | "changed" | "unchanged";

interface DiffRow {
  path: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
}

const ROOT = "(value)";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Flattens nested objects/arrays into dot-paths (`a.b[0].c`). Empty containers are leaves. */
export function flatten(value: unknown, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix || ROOT, [] as Leaf);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out.set(prefix, {} as Leaf);
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out.set(prefix || ROOT, value);
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffObjects(before: unknown, after: unknown): DiffRow[] {
  const a = flatten(before ?? undefined);
  const b = flatten(after ?? undefined);
  const paths = Array.from(new Set([...a.keys(), ...b.keys()])).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  return paths.map((path) => {
    const inA = a.has(path);
    const inB = b.has(path);
    if (inA && !inB) return { path, kind: "removed", before: a.get(path) };
    if (!inA && inB) return { path, kind: "added", after: b.get(path) };
    const va = a.get(path);
    const vb = b.get(path);
    return { path, kind: same(va, vb) ? "unchanged" : "changed", before: va, after: vb };
  });
}

function renderValue(v: unknown): string {
  return v === undefined ? "" : JSON.stringify(v);
}

function pretty(v: unknown): string {
  if (v === undefined || v === null) return "null";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const kindMeta: Record<ChangeKind, { label: string; icon: React.ComponentType<{ className?: string }>; tone: "success" | "critical" | "medium" | "neutral" }> = {
  added: { label: "Added", icon: Plus, tone: "success" },
  removed: { label: "Removed", icon: Minus, tone: "critical" },
  changed: { label: "Changed", icon: PenLine, tone: "medium" },
  unchanged: { label: "Unchanged", icon: Equal, tone: "neutral" },
};

function ValueCell({ value, kind, side }: { value: unknown; kind: ChangeKind; side: "before" | "after" }) {
  const present = side === "before" ? kind !== "added" : kind !== "removed";
  if (!present) return <span className="text-muted-foreground/60">—</span>;
  const highlight =
    side === "before" && (kind === "changed" || kind === "removed")
      ? "bg-sev-critical/10 text-sev-critical line-through decoration-sev-critical/60"
      : side === "after" && (kind === "changed" || kind === "added")
        ? "bg-sev-none/12 text-sev-none"
        : "text-foreground/80";
  return (
    <code className={cn("inline-block max-w-full whitespace-pre-wrap break-all rounded px-1 py-0.5 font-mono text-[11px] leading-4", highlight)}>
      {renderValue(value)}
    </code>
  );
}

/** Before/after viewer for audit entries: flattened change table + raw JSON side by side. */
export function JsonDiff({ before, after, className }: { before: unknown; after: unknown; className?: string }) {
  const rows = React.useMemo(() => diffObjects(before, after), [before, after]);
  const [showUnchanged, setShowUnchanged] = React.useState(false);
  const [raw, setRaw] = React.useState(false);
  const id = React.useId();

  const counts = rows.reduce<Record<ChangeKind, number>>(
    (acc, r) => {
      acc[r.kind] += 1;
      return acc;
    },
    { added: 0, removed: 0, changed: 0, unchanged: 0 },
  );
  const visible = showUnchanged ? rows : rows.filter((r) => r.kind !== "unchanged");
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;

  if (!hasBefore && !hasAfter) {
    return <p className={cn("rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground", className)}>No before/after data recorded for this event.</p>;
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {(["changed", "added", "removed"] as const).map((k) =>
            counts[k] ? (
              <Badge key={k} tone={kindMeta[k].tone}>
                {React.createElement(kindMeta[k].icon)} {counts[k]} {kindMeta[k].label.toLowerCase()}
              </Badge>
            ) : null,
          )}
          {counts.changed + counts.added + counts.removed === 0 && <Badge tone="neutral">No differences</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {!raw && counts.unchanged > 0 && (
            <div className="flex items-center gap-1.5">
              <Switch id={`${id}-unchanged`} checked={showUnchanged} onCheckedChange={setShowUnchanged} />
              <Label htmlFor={`${id}-unchanged`} className="text-xs font-normal">
                Unchanged ({counts.unchanged})
              </Label>
            </div>
          )}
          <Button type="button" variant="outline" size="xs" onClick={() => setRaw((r) => !r)} aria-pressed={raw}>
            <Braces /> {raw ? "Changes" : "Raw JSON"}
          </Button>
        </div>
      </div>

      {raw ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {([
            ["Before", before],
            ["After", after],
          ] as const).map(([label, v]) => (
            <div key={label} className="min-w-0 rounded-md border bg-muted/40">
              <div className="flex items-center justify-between border-b px-2.5 py-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                <CopyButton value={pretty(v)} label={`Copy ${label.toLowerCase()} JSON`} />
              </div>
              <pre className="max-h-80 overflow-auto p-2.5 font-mono text-[11px] leading-4 scrollbar-thin">{pretty(v)}</pre>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Before and after are identical.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border scrollbar-thin">
          <table className="w-full min-w-[28rem] text-xs">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-[34%] px-2.5 py-1.5 text-left font-medium">Field</th>
                <th className="w-[33%] px-2.5 py-1.5 text-left font-medium">Before</th>
                <th className="w-[33%] px-2.5 py-1.5 text-left font-medium">After</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((r) => {
                const Icon = kindMeta[r.kind].icon;
                return (
                  <tr key={r.path} className="align-top">
                    <td className="px-2.5 py-1.5">
                      <span className="flex items-start gap-1.5">
                        <Icon
                          className={cn(
                            "mt-0.5 size-3 shrink-0",
                            r.kind === "added" ? "text-sev-none" : r.kind === "removed" ? "text-sev-critical" : r.kind === "changed" ? "text-sev-medium" : "text-muted-foreground",
                          )}
                          aria-label={kindMeta[r.kind].label}
                        />
                        <span className="break-all font-mono text-[11px]">{r.path}</span>
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <ValueCell value={r.before} kind={r.kind} side="before" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <ValueCell value={r.after} kind={r.kind} side="after" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
