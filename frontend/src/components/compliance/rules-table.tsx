"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Calculator, ListChecks } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { normalizeList } from "@/hooks/use-list-query";
import { RISK_LEVELS, type ComplianceRule, type Paginated, type RiskLevel } from "@/types/api";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect, enumOptions } from "@/components/data-table/filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeverityBadge, ToneDot } from "@/components/common/status-badges";
import { OsIcon } from "@/components/common/os-icon";
import { RISK_ORDER, riskMeta } from "@/lib/status";

type RulePatch = Partial<Pick<ComplianceRule, "severity" | "weight" | "enabled" | "markNonCompliant">>;
const RULES_KEY = ["compliance", "rules"] as const;

function useRuleUpdate() {
  const qc = useQueryClient();
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  const update = React.useCallback(
    async (rule: ComplianceRule, patch: RulePatch, label: string) => {
      const prev = qc.getQueryData<ComplianceRule[]>(RULES_KEY);
      // Optimistic update.
      qc.setQueryData<ComplianceRule[]>(RULES_KEY, (old) => old?.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
      setPending((p) => ({ ...p, [rule.id]: true }));
      try {
        const saved = await api.patch<ComplianceRule>(`/compliance/rules/${rule.id}`, patch);
        if (saved && typeof saved === "object" && "id" in saved) {
          qc.setQueryData<ComplianceRule[]>(RULES_KEY, (old) => old?.map((r) => (r.id === rule.id ? { ...r, ...saved } : r)));
        }
        toast.success(`${rule.name}: ${label}`, { description: "Applies from the next evaluation of each device." });
        void qc.invalidateQueries({ queryKey: ["compliance", "summary"] });
      } catch (err) {
        if (prev) qc.setQueryData(RULES_KEY, prev);
        toast.error("Could not update rule", { description: errorMessage(err) });
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[rule.id];
          return next;
        });
      }
    },
    [qc],
  );
  return { update, pending };
}

function WeightInput({ rule, disabled, onCommit }: { rule: ComplianceRule; disabled: boolean; onCommit: (w: number) => void }) {
  const [value, setValue] = React.useState(String(rule.weight));
  const commit = () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isInteger(n) || n < 0 || n > 100) {
      toast.error("Weight must be a whole number between 0 and 100");
      setValue(String(rule.weight));
      return;
    }
    if (n !== rule.weight) onCommit(n);
  };
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      value={value}
      disabled={disabled}
      aria-label={`Weight for ${rule.name}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setValue(String(rule.weight));
        }
      }}
      className="h-8 w-16 text-right tabular"
    />
  );
}

export function RulesTable() {
  const { can } = useAuth();
  const canWrite = can("compliance:write");
  const { update, pending } = useRuleUpdate();
  const [search, setSearch] = React.useState("");
  const [severity, setSeverity] = React.useState<string | undefined>(undefined);

  const q = useQuery({
    queryKey: RULES_KEY,
    queryFn: async ({ signal }) => normalizeList(await api.get<Paginated<ComplianceRule> | ComplianceRule[]>("/compliance/rules", undefined, { signal })).data,
  });

  const rows = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    return [...(q.data ?? [])]
      .filter((r) => (!severity || r.severity === severity) && (!s || r.key.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)))
      .sort((a, b) => RISK_ORDER.indexOf(a.severity) - RISK_ORDER.indexOf(b.severity) || b.weight - a.weight);
  }, [q.data, search, severity]);

  const enabledWeight = (q.data ?? []).filter((r) => r.enabled).reduce((a, r) => a + r.weight, 0);

  const columns = React.useMemo<ColumnDef<ComplianceRule, unknown>[]>(
    () => [
      {
        id: "key",
        accessorKey: "key",
        header: "Rule key",
        meta: { label: "Rule key" },
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.key}</span>,
      },
      {
        id: "name",
        accessorKey: "name",
        header: "Rule",
        meta: { label: "Rule" },
        cell: ({ row }) => (
          <div className="min-w-[220px] max-w-[380px]">
            <div className="font-medium">{row.original.name}</div>
            {row.original.description && <p className="text-xs text-muted-foreground">{row.original.description}</p>}
          </div>
        ),
      },
      {
        id: "platforms",
        header: "Platforms",
        enableSorting: false,
        meta: { label: "Platforms" },
        cell: ({ row }) =>
          row.original.platforms.length === 0 ? (
            <span className="text-xs text-muted-foreground">All</span>
          ) : (
            <div className="flex items-center gap-1">
              {row.original.platforms.map((p) => (
                <OsIcon key={p} platform={p} />
              ))}
            </div>
          ),
      },
      {
        id: "severity",
        accessorFn: (r) => RISK_ORDER.indexOf(r.severity),
        header: "Severity",
        meta: { label: "Severity" },
        cell: ({ row }) =>
          canWrite ? (
            <Select
              value={row.original.severity}
              disabled={!!pending[row.original.id]}
              onValueChange={(v) => update(row.original, { severity: v as RiskLevel }, `severity set to ${riskMeta[v as RiskLevel].label}`)}
            >
              <SelectTrigger size="sm" className="h-8 w-[118px]" aria-label={`Severity for ${row.original.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RISK_LEVELS.filter((r) => r !== "NONE").map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="flex items-center gap-2">
                      <ToneDot tone={riskMeta[r].tone} /> {riskMeta[r].label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <SeverityBadge value={row.original.severity} />
          ),
      },
      {
        id: "weight",
        accessorKey: "weight",
        header: "Weight",
        meta: { label: "Weight" },
        cell: ({ row }) =>
          canWrite ? (
            <WeightInput
              key={`${row.original.id}:${row.original.weight}`}
              rule={row.original}
              disabled={!!pending[row.original.id]}
              onCommit={(w) => update(row.original, { weight: w }, `weight set to ${w}`)}
            />
          ) : (
            <span className="font-medium tabular">−{row.original.weight}</span>
          ),
      },
      {
        id: "markNonCompliant",
        accessorKey: "markNonCompliant",
        header: "Non-compliant",
        meta: { label: "Marks non-compliant" },
        cell: ({ row }) =>
          canWrite ? (
            <Switch
              checked={row.original.markNonCompliant}
              disabled={!!pending[row.original.id]}
              aria-label={`${row.original.name} marks device non-compliant`}
              onCheckedChange={(v) =>
                update(row.original, { markNonCompliant: v }, v ? "failure now marks devices non-compliant" : "failure only lowers the score")
              }
            />
          ) : row.original.markNonCompliant ? (
            <Badge tone="critical">Yes</Badge>
          ) : (
            <Badge tone="neutral">Score only</Badge>
          ),
      },
      {
        id: "enabled",
        accessorKey: "enabled",
        header: "Enabled",
        meta: { label: "Enabled" },
        cell: ({ row }) =>
          canWrite ? (
            <Switch
              checked={row.original.enabled}
              disabled={!!pending[row.original.id]}
              aria-label={`${row.original.name} enabled`}
              onCheckedChange={(v) => update(row.original, { enabled: v }, v ? "enabled" : "disabled")}
            />
          ) : row.original.enabled ? (
            <Badge tone="success" dot>
              Enabled
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              Disabled
            </Badge>
          ),
      },
    ],
    [canWrite, pending, update],
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Calculator className="size-4" />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p>
              <span className="font-medium">Score</span> ={" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">max(0, 100 − Σ weight of failed rules)</code>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A device is <span className="font-medium text-foreground">Non-compliant</span> if any failed rule has “Non-compliant” set, and{" "}
              <span className="font-medium text-foreground">Unknown</span> until security data is received. Its risk level is the highest
              severity among failed rules. Disabled rules are skipped.
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <div className="text-lg font-semibold tabular">{enabledWeight}</div>
            <div className="text-[11px] text-muted-foreground">total weight of enabled rules</div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={rows}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        getRowId={(r) => r.id}
        search={{ value: search, onChange: setSearch, placeholder: "Search rules…" }}
        filters={
          <FilterSelect
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={enumOptions(
              RISK_LEVELS.filter((r) => r !== "NONE"),
              (r) => riskMeta[r].label,
            )}
          />
        }
        rowClassName={(r) => (r.enabled ? undefined : "opacity-60")}
        pageSizeOptions={[25, 50, 100]}
        empty={{ icon: ListChecks, title: "No compliance rules", description: "Built-in rules are seeded by the backend on first start." }}
      />
    </div>
  );
}
