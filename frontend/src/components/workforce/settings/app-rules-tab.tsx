"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Info, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListQuery } from "@/hooks/use-list-query";
import { useDepartments } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import { categoryMeta, toneDot } from "@/lib/status";
import { cn } from "@/lib/utils";
import { KindIcon } from "@/components/workforce/common";
import { APP_RULE_INVALIDATE, AppRuleDialog, KIND_LABEL, MATCH_LABEL } from "@/components/workforce/settings/app-rule-dialog";
import { ACTIVITY_CATEGORIES, APP_RULE_KINDS, type ActivityCategory, type AppRule } from "@/types/api";

function InlineCategory({ rule }: { rule: AppRule }) {
  const change = useApiMutation((category: ActivityCategory) => api.patch<AppRule>(`/workforce/app-rules/${rule.id}`, { category }), {
    success: (_r, c) => `${rule.label} → ${categoryMeta[c].label}`,
    invalidate: APP_RULE_INVALIDATE,
  });
  const value = change.isPending && change.variables ? change.variables : rule.category;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select value={value} onValueChange={(c) => change.mutate(c as ActivityCategory)} disabled={change.isPending}>
        <SelectTrigger size="sm" aria-label={`Category for ${rule.label}`} className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTIVITY_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              <span className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", toneDot[categoryMeta[c].tone])} aria-hidden />
                {categoryMeta[c].label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function AppRulesTab() {
  const list = useListQuery<AppRule>(["workforce", "app-rules"], "/workforce/app-rules", { initial: { pageSize: 50 } });
  const deps = useDepartments();
  const confirm = useConfirm();
  const [dialog, setDialog] = React.useState<{ open: boolean; rule: AppRule | null }>({ open: false, rule: null });

  const del = useApiMutation((r: AppRule) => api.delete(`/workforce/app-rules/${r.id}`), {
    success: (_d, r) => `Rule for ${r.label} deleted`,
    invalidate: APP_RULE_INVALIDATE,
  });

  const onDelete = React.useCallback(
    async (r: AppRule) => {
      const ok = await confirm({
        title: `Delete rule for ${r.label}?`,
        description: "Matching activity falls back to other rules, or becomes Uncategorized. Past days are not recalculated.",
        confirmLabel: "Delete rule",
        destructive: true,
      });
      if (ok) del.mutate(r);
    },
    [confirm, del],
  );

  const depName = React.useCallback(
    (r: AppRule) => r.department?.name ?? deps.data?.find((d) => d.id === r.departmentId)?.name ?? "Department",
    [deps.data],
  );

  const columns = React.useMemo<ColumnDef<AppRule, unknown>[]>(
    () => [
      {
        id: "kind",
        header: "Kind",
        meta: { label: "Kind" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
            <KindIcon kind={row.original.kind} />
            <span aria-hidden>{KIND_LABEL[row.original.kind]}</span>
          </span>
        ),
      },
      {
        id: "pattern",
        header: "Pattern",
        meta: { label: "Pattern" },
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate font-mono text-xs" title={row.original.pattern}>
            {row.original.pattern}
          </span>
        ),
      },
      {
        id: "matchType",
        header: "Match",
        meta: { label: "Match type" },
        cell: ({ row }) => <span className="text-xs">{MATCH_LABEL[row.original.matchType] ?? row.original.matchType}</span>,
      },
      {
        id: "label",
        header: "Label",
        meta: { label: "Label" },
        cell: ({ row }) => <span className="block max-w-[200px] truncate font-medium">{row.original.label}</span>,
      },
      {
        id: "category",
        header: "Category",
        enableSorting: false,
        meta: { label: "Category" },
        cell: ({ row }) => <InlineCategory rule={row.original} />,
      },
      {
        id: "department",
        header: "Scope",
        enableSorting: false,
        meta: { label: "Department" },
        cell: ({ row }) =>
          row.original.departmentId ? (
            <span className="whitespace-nowrap text-xs">{depName(row.original)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Global</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) => (
          <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-xs" aria-label={`Edit rule for ${row.original.label}`} onClick={() => setDialog({ open: true, rule: row.original })}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-destructive hover:text-destructive"
              aria-label={`Delete rule for ${row.original.label}`}
              onClick={() => void onDelete(row.original)}
            >
              <Trash2 />
            </Button>
          </div>
        ),
      },
    ],
    [depName, onDelete],
  );

  const depOptions = [{ value: "global", label: "Global only" }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))];

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">Precedence:</span> a department rule beats a global rule; within the same scope{" "}
          <span className="font-medium text-foreground">Exact</span> beats <span className="font-medium text-foreground">Contains</span> beats{" "}
          <span className="font-medium text-foreground">Regex</span>. Websites are matched on the domain only (e.g. <code className="font-mono">github.com</code>
          ), never the full URL. Unmatched activity is Uncategorized.
        </span>
      </div>
      <DataTable
        columns={columns}
        data={list.rows}
        meta={list.meta}
        loading={list.query.isLoading}
        fetching={list.query.isFetching}
        error={list.query.error}
        onRetry={() => list.query.refetch()}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        getRowId={(r) => r.id}
        onRowClick={(r) => setDialog({ open: true, rule: r })}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search pattern or label…" }}
        filters={
          <>
            <FilterSelect
              label="Kind"
              value={list.state.filters.kind as string | undefined}
              onChange={(v) => list.setFilter("kind", v)}
              options={enumOptions(APP_RULE_KINDS, (k) => KIND_LABEL[k])}
            />
            <FilterSelect
              label="Category"
              value={list.state.filters.category as string | undefined}
              onChange={(v) => list.setFilter("category", v)}
              options={enumOptions(ACTIVITY_CATEGORIES, (c) => categoryMeta[c].label)}
            />
            {(deps.data?.length ?? 0) > 0 && (
              <FilterSelect
                label="Scope"
                value={list.state.filters.departmentId as string | undefined}
                onChange={(v) => list.setFilter("departmentId", v)}
                options={depOptions}
              />
            )}
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        actions={
          <Button size="sm" onClick={() => setDialog({ open: true, rule: null })}>
            <Plus /> New rule
          </Button>
        }
        empty={{
          icon: Tags,
          title: list.activeFilterCount || list.state.search ? "No matching rules" : "No category rules yet",
          description: "Classify apps and website domains so productivity can be calculated. Check the Uncategorized tab for the most-used unmatched items.",
        }}
      />
      <AppRuleDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} rule={dialog.rule} />
    </div>
  );
}
