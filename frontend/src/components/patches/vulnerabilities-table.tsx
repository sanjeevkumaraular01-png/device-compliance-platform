"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/data-table/filters";
import { Mono } from "@/components/common/misc";
import { Badge } from "@/components/ui/badge";
import { normalizeList } from "@/hooks/use-list-query";
import { formatNumber } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { Paginated, Vulnerability } from "@/types/api";

const FETCH_LIMIT = 200;

type CvssBand = "critical" | "high" | "medium" | "low" | "none";

function cvssBand(score: number | null | undefined): CvssBand {
  if (score === null || score === undefined) return "none";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

const bandMeta: Record<CvssBand, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "medium" },
  low: { label: "Low", tone: "low" },
  none: { label: "Unscored", tone: "unknown" },
};

export function VulnerabilitiesTable() {
  const [search, setSearch] = React.useState("");
  const [band, setBand] = React.useState<string | undefined>();

  const q = useQuery({
    queryKey: ["patches", "vulnerabilities", FETCH_LIMIT],
    queryFn: async () =>
      normalizeList(
        await api.get<Paginated<Vulnerability> | Vulnerability[]>("/patches/vulnerabilities", {
          pageSize: FETCH_LIMIT,
          sortBy: "cvssScore",
          sortOrder: "desc",
        }),
      ),
  });

  const rows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(q.data?.data ?? [])]
      .filter((v) => (band ? cvssBand(v.cvssScore) === band : true))
      .filter((v) => !term || v.cveId.toLowerCase().includes(term) || v.patchIds.some((p) => p.toLowerCase().includes(term)))
      .sort((a, b) => (b.cvssScore ?? -1) - (a.cvssScore ?? -1) || b.affectedDevices - a.affectedDevices);
  }, [q.data, search, band]);

  const total = q.data?.meta.total ?? 0;
  const truncated = total > (q.data?.data.length ?? 0);

  const columns = React.useMemo<ColumnDef<Vulnerability, unknown>[]>(
    () => [
      {
        id: "cveId",
        accessorKey: "cveId",
        header: "CVE",
        enableHiding: false,
        meta: { label: "CVE" },
        cell: ({ row }) => <Mono className="whitespace-nowrap font-medium">{row.original.cveId}</Mono>,
      },
      {
        id: "cvssScore",
        accessorFn: (r) => r.cvssScore ?? -1,
        header: "CVSS",
        meta: { label: "CVSS" },
        cell: ({ row }) => {
          const s = row.original.cvssScore;
          const m = bandMeta[cvssBand(s)];
          return (
            <Badge tone={m.tone} className="tabular">
              {s === null || s === undefined ? "—" : s.toFixed(1)}
              <span className="font-normal opacity-80">{m.label}</span>
            </Badge>
          );
        },
      },
      {
        id: "patchIds",
        header: "Fixed by",
        enableSorting: false,
        meta: { label: "Fixed by" },
        cell: ({ row }) => {
          const ids = row.original.patchIds ?? [];
          if (!ids.length) return <span className="text-muted-foreground">No patch available</span>;
          return (
            <div className="flex max-w-[360px] flex-wrap gap-1">
              {ids.map((id) => (
                <Mono key={id} className="whitespace-nowrap rounded bg-muted px-1 py-px text-[11px]">
                  {id}
                </Mono>
              ))}
            </div>
          );
        },
      },
      {
        id: "affectedDevices",
        accessorKey: "affectedDevices",
        header: "Affected devices",
        meta: { label: "Affected devices", className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => <span className="font-medium tabular">{formatNumber(row.original.affectedDevices)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="grid gap-2">
      <DataTable
        columns={columns}
        data={rows}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        getRowId={(r) => r.cveId}
        search={{ value: search, onChange: setSearch, placeholder: "Search CVE or patch ID…" }}
        filters={
          <FilterSelect
            label="CVSS"
            value={band}
            onChange={setBand}
            options={(["critical", "high", "medium", "low", "none"] as const).map((b) => ({
              value: b,
              label:
                b === "critical" ? "Critical (9.0+)" : b === "high" ? "High (7.0–8.9)" : b === "medium" ? "Medium (4.0–6.9)" : b === "low" ? "Low (< 4.0)" : "Unscored",
            }))}
          />
        }
        empty={{
          icon: ShieldCheck,
          title: search || band ? "No vulnerabilities match" : "No known vulnerabilities",
          description: search || band ? "Try a different search or filter." : "No missing patches reference a CVE right now.",
        }}
      />
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the {formatNumber(q.data?.data.length)} highest-scored of {formatNumber(total)} vulnerabilities.
        </p>
      )}
    </div>
  );
}
