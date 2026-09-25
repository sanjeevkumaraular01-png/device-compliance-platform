"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardCheck } from "lucide-react";
import { useListQuery } from "@/hooks/use-list-query";
import { useDepartments } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { COMPLIANCE_STATES, RISK_LEVELS, type ComplianceResult } from "@/types/api";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { ComplianceBadge, RiskBadge } from "@/components/common/status-badges";
import { ScoreRing } from "@/components/common/score-ring";
import { RelativeTime } from "@/components/common/misc";
import { OsIcon } from "@/components/common/os-icon";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { complianceMeta, riskMeta, toneText } from "@/lib/status";
import { cn } from "@/lib/utils";
import { FindingsSheet, resultDeviceName } from "@/components/compliance/findings-sheet";

function SeverityCounts({ r }: { r: ComplianceResult }) {
  const items = [
    { label: "Critical", value: r.criticalCount, tone: "critical" as const },
    { label: "High", value: r.highCount, tone: "high" as const },
    { label: "Medium", value: r.mediumCount, tone: "medium" as const },
    { label: "Low", value: r.lowCount, tone: "low" as const },
  ];
  return (
    <SimpleTooltip label={items.map((i) => `${i.label}: ${i.value}`).join(" · ")}>
      <span className="inline-flex items-center gap-2.5 font-mono text-xs tabular" tabIndex={0}>
        {items.map((i) => (
          <span key={i.label} className={cn("min-w-4 text-center", i.value > 0 ? cn("font-semibold", toneText[i.tone]) : "text-muted-foreground/50")}>
            {i.value}
          </span>
        ))}
      </span>
    </SimpleTooltip>
  );
}

export function ResultsTable() {
  const { can } = useAuth();
  const canOpenDevice = can("devices:read");
  const departments = useDepartments();
  const list = useListQuery<ComplianceResult>("compliance", "/compliance/results", {
    initial: { sortBy: "evaluatedAt", sortOrder: "desc" },
  });
  const [selected, setSelected] = React.useState<ComplianceResult | null>(null);
  const [open, setOpen] = React.useState(false);

  const openResult = React.useCallback((r: ComplianceResult) => {
    setSelected(r);
    setOpen(true);
  }, []);

  const columns = React.useMemo<ColumnDef<ComplianceResult, unknown>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        enableSorting: false,
        meta: { label: "Device" },
        cell: ({ row }) => {
          const r = row.original;
          const name = resultDeviceName(r);
          return (
            <div className="flex min-w-[160px] items-center gap-2">
              {r.device?.platform && <OsIcon platform={r.device.platform} />}
              <div className="min-w-0">
                {canOpenDevice ? (
                  <Link
                    href={`/devices/${r.deviceId}`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn("block truncate font-medium hover:text-primary hover:underline", !r.device?.deviceName && "font-mono text-xs")}
                  >
                    {name}
                  </Link>
                ) : (
                  <span className={cn("block truncate font-medium", !r.device?.deviceName && "font-mono text-xs")}>{name}</span>
                )}
                {r.device?.department && <span className="block truncate text-xs text-muted-foreground">{r.device.department.name}</span>}
              </div>
            </div>
          );
        },
      },
      {
        id: "score",
        accessorKey: "score",
        header: "Score",
        meta: { label: "Score" },
        cell: ({ row }) => <ScoreRing score={row.original.score} size={32} />,
      },
      {
        id: "state",
        accessorKey: "state",
        header: "State",
        meta: { label: "State" },
        cell: ({ row }) => <ComplianceBadge value={row.original.state} />,
      },
      {
        id: "riskLevel",
        accessorKey: "riskLevel",
        header: "Risk",
        meta: { label: "Risk" },
        cell: ({ row }) => <RiskBadge value={row.original.riskLevel} />,
      },
      {
        id: "counts",
        header: () => (
          <span className="inline-flex gap-2.5 font-mono text-[10px]">
            <span className={toneText.critical}>C</span>
            <span className={toneText.high}>H</span>
            <span className={toneText.medium}>M</span>
            <span className={toneText.low}>L</span>
          </span>
        ),
        enableSorting: false,
        meta: { label: "Failed by severity" },
        cell: ({ row }) => <SeverityCounts r={row.original} />,
      },
      {
        id: "policyVersion",
        accessorKey: "policyVersion",
        header: "Policy",
        enableSorting: false,
        meta: { label: "Policy version" },
        cell: ({ row }) =>
          row.original.policyVersion ? <span className="font-mono text-xs">v{row.original.policyVersion}</span> : <span className="text-muted-foreground">—</span>,
      },
      {
        id: "evaluatedAt",
        accessorKey: "evaluatedAt",
        header: "Evaluated",
        meta: { label: "Evaluated" },
        cell: ({ row }) => <RelativeTime value={row.original.evaluatedAt} className="text-xs" />,
      },
    ],
    [canOpenDevice],
  );

  const f = list.state.filters;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  return (
    <>
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
        sortBy={list.state.sortBy}
        sortOrder={list.state.sortOrder}
        onSortChange={list.setSort}
        getRowId={(r) => r.id}
        onRowClick={openResult}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search devices…" }}
        filters={
          <>
            <FilterSelect
              label="State"
              value={str(f.state)}
              onChange={(v) => list.setFilter("state", v)}
              options={enumOptions(COMPLIANCE_STATES, (s) => complianceMeta[s].label)}
            />
            <FilterSelect
              label="Risk"
              value={str(f.riskLevel)}
              onChange={(v) => list.setFilter("riskLevel", v)}
              options={enumOptions(RISK_LEVELS, (r) => riskMeta[r].label)}
            />
            {(departments.data ?? []).length > 0 && (
              <FilterSelect
                label="Department"
                value={str(f.departmentId)}
                onChange={(v) => list.setFilter("departmentId", v)}
                options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        empty={{
          icon: ClipboardCheck,
          title: list.activeFilterCount ? "No results match the filters" : "No compliance results yet",
          description: "Results appear after devices report security data or an evaluation is run.",
        }}
      />
      <FindingsSheet result={selected} open={open} onOpenChange={setOpen} />
    </>
  );
}
