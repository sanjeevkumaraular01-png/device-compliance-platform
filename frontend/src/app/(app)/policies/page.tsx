"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldHalf } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import type { DevicePolicy, Paginated } from "@/types/api";
import { DataTable } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { NewPolicyDialog } from "@/components/policies/new-policy-dialog";
import { PolicyControlBadges } from "@/components/policies/policy-control-badges";
import { PolicyRowActions } from "@/components/policies/policy-row-actions";
import { formatNumber } from "@/lib/format";

export default function PoliciesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can("policies:write");
  const confirm = useConfirm();
  const [search, setSearch] = React.useState("");

  const query = useQuery({
    queryKey: ["policies", "list"],
    queryFn: async ({ signal }) =>
      normalizeList(await api.get<Paginated<DevicePolicy> | DevicePolicy[]>("/policies", { pageSize: 200 }, { signal })).data,
  });

  const remove = useApiMutation((p: DevicePolicy) => api.delete(`/policies/${p.id}`), {
    success: (_d, p) => `Policy “${p.name}” deleted`,
    invalidate: [["policies"], ["devices"]],
  });

  const onDelete = React.useCallback(
    async (p: DevicePolicy) => {
      const ok = await confirm({
        title: `Delete policy “${p.name}”?`,
        description:
          "Devices and departments assigned to this policy fall back to their department policy or the default policy, and are re-evaluated for compliance.",
        confirmLabel: "Delete policy",
        destructive: true,
        typeToConfirm: p.name,
      });
      if (ok) remove.mutate(p);
    },
    [confirm, remove],
  );

  const rows = React.useMemo(() => {
    const all = [...(query.data ?? [])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.priority - b.priority || a.name.localeCompare(b.name));
    const s = search.trim().toLowerCase();
    if (!s) return all;
    return all.filter((p) => p.name.toLowerCase().includes(s) || (p.description ?? "").toLowerCase().includes(s));
  }, [query.data, search]);

  const hasCounts = rows.some((p) => p._count?.devices !== undefined);

  const columns = React.useMemo<ColumnDef<DevicePolicy, unknown>[]>(() => {
    const cols: ColumnDef<DevicePolicy, unknown>[] = [
      {
        id: "name",
        accessorKey: "name",
        header: "Policy",
        meta: { label: "Policy" },
        cell: ({ row }) => (
          <div className="min-w-[200px] max-w-[360px]">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{row.original.name}</span>
              {row.original.isDefault && (
                <Badge tone="primary" className="shrink-0">
                  Default
                </Badge>
              )}
            </div>
            {row.original.description && <p className="line-clamp-2 text-xs text-muted-foreground">{row.original.description}</p>}
          </div>
        ),
      },
      {
        id: "version",
        accessorKey: "version",
        header: "Version",
        meta: { label: "Version" },
        cell: ({ row }) => <span className="font-mono text-xs">v{row.original.version}</span>,
      },
      {
        id: "priority",
        accessorKey: "priority",
        header: "Priority",
        meta: { label: "Priority" },
        cell: ({ row }) => <span className="tabular">{row.original.priority}</span>,
      },
      {
        id: "controls",
        header: "Key controls",
        enableSorting: false,
        meta: { label: "Key controls" },
        cell: ({ row }) => <PolicyControlBadges policy={row.original} />,
      },
    ];
    if (hasCounts) {
      cols.push({
        id: "devices",
        header: "Devices",
        accessorFn: (p) => p._count?.devices ?? 0,
        meta: { label: "Devices" },
        cell: ({ row }) => <span className="tabular">{formatNumber(row.original._count?.devices ?? 0)}</span>,
      });
    }
    cols.push(
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        meta: { label: "Updated" },
        cell: ({ row }) => <RelativeTime value={row.original.updatedAt} className="text-xs" />,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px" },
        cell: ({ row }) => (
          <PolicyRowActions
            policy={row.original}
            canWrite={canWrite}
            onOpen={() => router.push(`/policies/${row.original.id}`)}
            onDelete={() => onDelete(row.original)}
          />
        ),
      },
    );
    return cols;
  }, [hasCounts, canWrite, router, onDelete]);

  return (
    <>
      <PageHeader
        title="Policies"
        icon={ShieldHalf}
        description="Security baselines pushed to endpoints. Resolution order: device policy → department policy → default policy."
        actions={canWrite ? <NewPolicyDialog /> : undefined}
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={query.isLoading}
        fetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        getRowId={(p) => p.id}
        onRowClick={(p) => router.push(`/policies/${p.id}`)}
        search={{ value: search, onChange: setSearch, placeholder: "Search policies…" }}
        empty={{
          icon: ShieldHalf,
          title: search ? "No policies match your search" : "No policies yet",
          description: "Policies define USB, software, endpoint protection, patching and screen lock controls.",
          action: canWrite && !search ? <NewPolicyDialog /> : undefined,
        }}
      />
    </>
  );
}
