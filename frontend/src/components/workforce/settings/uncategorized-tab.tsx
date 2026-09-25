"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Info, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { DateRangeFilter } from "@/components/data-table/filters";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { normalizeList } from "@/hooks/use-list-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { categoryMeta, toneDot } from "@/lib/status";
import { cn } from "@/lib/utils";
import { KindIcon, fmtHm, shiftDate, todayLocal } from "@/components/workforce/common";
import { APP_RULE_INVALIDATE, AppRuleDialog, KIND_LABEL } from "@/components/workforce/settings/app-rule-dialog";
import type { ActivityCategory, AppRule, AppRuleInput, Paginated, UncategorizedItem } from "@/types/api";

const QUICK: ActivityCategory[] = ["PRODUCTIVE", "NEUTRAL", "UNPRODUCTIVE", "BLOCKED"];
const keyOf = (i: Pick<UncategorizedItem, "kind" | "value">) => `${i.kind}:${i.value}`;

export function UncategorizedTab() {
  const [range, setRange] = React.useState<{ from?: string; to?: string }>(() => {
    const to = todayLocal();
    return { from: shiftDate(to, -6), to };
  });
  const [done, setDone] = React.useState<Set<string>>(() => new Set());
  const [custom, setCustom] = React.useState<Partial<AppRuleInput> | null>(null);

  const q = useQuery({
    queryKey: ["workforce", "uncategorized", range.from, range.to],
    queryFn: async () =>
      normalizeList(await api.get<UncategorizedItem[] | Paginated<UncategorizedItem>>("/workforce/uncategorized", { from: range.from, to: range.to })).data,
  });

  const categorize = useApiMutation(
    (v: { item: UncategorizedItem; category: ActivityCategory }) =>
      api.post<AppRule>("/workforce/app-rules", {
        kind: v.item.kind,
        pattern: v.item.value,
        matchType: "EXACT",
        label: v.item.value,
        category: v.category,
      } satisfies AppRuleInput),
    {
      success: (_r, v) => `${v.item.value} marked as ${categoryMeta[v.category].label}`,
      invalidate: APP_RULE_INVALIDATE,
      onSuccess: (_r, v) => setDone((prev) => new Set(prev).add(keyOf(v.item))),
    },
  );

  const rows = React.useMemo(
    () => [...(q.data ?? [])].filter((i) => !done.has(keyOf(i))).sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0)),
    [q.data, done],
  );
  const pendingKey = categorize.isPending && categorize.variables ? keyOf(categorize.variables.item) : null;

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0 text-primary" />
        <span>
          The most-used apps and website domains that no rule matches. One click creates a global <span className="font-medium text-foreground">Exact</span>{" "}
          rule; use Customize… for a department-specific or pattern rule.
        </span>
      </div>
      <div className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b p-2.5">
          <DateRangeFilter from={range.from} to={range.to} onChange={(r) => {
              setRange(r);
              setDone(new Set());
            }}
            className="flex-wrap" />
          {q.isFetching && !q.isLoading && <span className="text-xs text-muted-foreground">Refreshing…</span>}
          {rows.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{formatNumber(rows.length)} items</span>}
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="Everything is categorized"
            description="No unmatched apps or domains in this period. New ones appear here as agents report activity."
            className="py-10"
          />
        ) : (
          <Table containerClassName="scrollbar-thin">
            <TableHeader>
              <TableRow>
                <TableHead>App / domain</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead>Categorize</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => {
                const k = keyOf(i);
                const busy = pendingKey === k;
                return (
                  <TableRow key={k} className={cn(busy && "opacity-60")}>
                    <TableCell>
                      <span className="block max-w-[260px] truncate font-mono text-xs" title={i.value}>
                        {i.value}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
                        <KindIcon kind={i.kind} />
                        <span aria-hidden>{KIND_LABEL[i.kind] ?? i.kind}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular">{fmtHm(i.seconds)}</TableCell>
                    <TableCell className="text-right text-xs tabular">{formatNumber(i.users)}</TableCell>
                    <TableCell>
                      <div className="flex flex-nowrap items-center gap-1">
                        {QUICK.map((c) => (
                          <Button
                            key={c}
                            variant="outline"
                            size="xs"
                            disabled={categorize.isPending}
                            aria-label={`Mark ${i.value} as ${categoryMeta[c].label}`}
                            onClick={() => categorize.mutate({ item: i, category: c })}
                          >
                            <span className={cn("size-2 rounded-full", toneDot[categoryMeta[c].tone])} aria-hidden />
                            {categoryMeta[c].label}
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Customize rule for ${i.value}`}
                          onClick={() => setCustom({ kind: i.kind, pattern: i.value, label: i.value, matchType: "EXACT", category: "PRODUCTIVE" })}
                        >
                          <SlidersHorizontal /> Customize…
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <AppRuleDialog open={!!custom} onOpenChange={(o) => !o && setCustom(null)} rule={null} initial={custom ?? undefined} />
    </div>
  );
}
