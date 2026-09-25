"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments, usePolicies } from "@/hooks/use-lookups";
import type { EnrollmentToken } from "@/types/api";
import { DataTable } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/data-table/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useConfirm } from "@/components/common/confirm-dialog";
import { RelativeTime } from "@/components/common/misc";
import { OsIcon } from "@/components/common/os-icon";
import { formatDate, formatNumber } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { tokenState, useEnrollmentTokens, type TokenState } from "@/components/enrollment/enrollment-queries";
import { CreateTokenDialog } from "@/components/enrollment/create-token-dialog";

const stateMeta: Record<TokenState, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  exhausted: { label: "Exhausted", tone: "medium" },
  revoked: { label: "Revoked", tone: "critical" },
};

export function TokensTab() {
  const tokens = useEnrollmentTokens();
  const departments = useDepartments();
  const policies = usePolicies();
  const confirm = useConfirm();
  const [stateFilter, setStateFilter] = React.useState<string | undefined>(undefined);
  const [search, setSearch] = React.useState("");

  const deptName = React.useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d.name])), [departments.data]);
  const policyName = React.useMemo(() => new Map((policies.data ?? []).map((p) => [p.id, p.name])), [policies.data]);

  const revoke = useApiMutation((t: EnrollmentToken) => api.delete(`/enrollment/tokens/${t.id}`), {
    success: (_d, t) => `Token “${t.name}” revoked`,
    invalidate: [["enrollment"]],
  });

  const onRevoke = React.useCallback(
    async (t: EnrollmentToken) => {
      const ok = await confirm({
        title: `Revoke token “${t.name}”?`,
        description: "Devices can no longer enroll with this token. Devices that already enrolled are not affected. This cannot be undone.",
        confirmLabel: "Revoke token",
        destructive: true,
      });
      if (ok) revoke.mutate(t);
    },
    [confirm, revoke],
  );

  const rows = React.useMemo(() => {
    const all = tokens.data ?? [];
    const s = search.trim().toLowerCase();
    return all.filter(
      (t) => (!stateFilter || tokenState(t) === stateFilter) && (!s || t.name.toLowerCase().includes(s) || t.tokenPrefix.toLowerCase().includes(s)),
    );
  }, [tokens.data, stateFilter, search]);

  const columns = React.useMemo<ColumnDef<EnrollmentToken, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name" },
        cell: ({ row }) => (
          <div className="min-w-[140px]">
            <div className="font-medium">{row.original.name}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{row.original.tokenPrefix}…</div>
          </div>
        ),
      },
      {
        id: "platform",
        accessorKey: "platform",
        header: "Platform",
        meta: { label: "Platform" },
        cell: ({ row }) =>
          row.original.platform ? <OsIcon platform={row.original.platform} withLabel /> : <span className="text-muted-foreground">Any</span>,
      },
      {
        id: "department",
        header: "Department",
        enableSorting: false,
        meta: { label: "Department" },
        cell: ({ row }) =>
          row.original.departmentId ? (
            <span className="whitespace-nowrap">{deptName.get(row.original.departmentId) ?? "Unknown department"}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "policy",
        header: "Policy",
        enableSorting: false,
        meta: { label: "Policy" },
        cell: ({ row }) =>
          row.original.policyId ? (
            <span className="whitespace-nowrap">{policyName.get(row.original.policyId) ?? "Unknown policy"}</span>
          ) : (
            <span className="text-muted-foreground">Inherit</span>
          ),
      },
      {
        id: "usedCount",
        accessorKey: "usedCount",
        header: "Uses",
        meta: { label: "Uses" },
        cell: ({ row }) => {
          const { usedCount, maxUses } = row.original;
          const ratio = maxUses > 0 ? (usedCount / maxUses) * 100 : 0;
          return (
            <div className="grid w-28 gap-1">
              <span className="text-xs tabular">
                {formatNumber(usedCount)} <span className="text-muted-foreground">/ {formatNumber(maxUses)}</span>
              </span>
              <Progress value={ratio} tone={ratio >= 100 ? "medium" : ratio >= 80 ? "high" : "primary"} aria-label="Token usage" />
            </div>
          );
        },
      },
      {
        id: "autoApprove",
        accessorKey: "autoApprove",
        header: "Approval",
        meta: { label: "Approval" },
        cell: ({ row }) =>
          row.original.autoApprove ? <Badge tone="info">Auto-approve</Badge> : <Badge tone="neutral">Manual review</Badge>,
      },
      {
        id: "expiresAt",
        accessorKey: "expiresAt",
        header: "Expires",
        meta: { label: "Expires" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.expiresAt)}</span>,
      },
      {
        id: "state",
        header: "Status",
        enableSorting: false,
        meta: { label: "Status" },
        cell: ({ row }) => {
          const st = tokenState(row.original);
          return (
            <Badge tone={stateMeta[st].tone} dot>
              {stateMeta[st].label}
            </Badge>
          );
        },
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Created",
        meta: { label: "Created" },
        cell: ({ row }) => <RelativeTime value={row.original.createdAt} className="text-xs" />,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) =>
          row.original.revokedAt ? null : (
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onRevoke(row.original)}
              disabled={revoke.isPending && revoke.variables?.id === row.original.id}
            >
              <Ban /> Revoke
            </Button>
          ),
      },
    ],
    [deptName, policyName, onRevoke, revoke.isPending, revoke.variables],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={tokens.isLoading}
      fetching={tokens.isFetching}
      error={tokens.error}
      onRetry={() => tokens.refetch()}
      getRowId={(t) => t.id}
      search={{ value: search, onChange: setSearch, placeholder: "Search name or prefix…" }}
      filters={
        <FilterSelect
          label="Status"
          value={stateFilter}
          onChange={setStateFilter}
          options={(Object.keys(stateMeta) as TokenState[]).map((k) => ({ value: k, label: stateMeta[k].label }))}
        />
      }
      actions={<CreateTokenDialog />}
      rowClassName={(t) => (tokenState(t) === "active" ? undefined : "opacity-70")}
      empty={{
        icon: KeyRound,
        title: search || stateFilter ? "No tokens match the filters" : "No enrollment tokens yet",
        description: "Create a token to generate install commands for Windows, Linux and macOS endpoints.",
      }}
    />
  );
}
