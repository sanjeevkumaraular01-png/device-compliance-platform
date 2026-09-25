"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Camera, CameraOff, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { useWorkforcePolicies } from "@/components/workforce/queries";
import { PolicyEditorSheet } from "@/components/workforce/settings/policy-editor-sheet";
import { AssignDepartmentsDialog } from "@/components/workforce/settings/assign-departments-dialog";
import { scheduleSummary } from "@/components/workforce/settings/policy-model";
import type { WorkforcePolicy } from "@/types/api";

export function PoliciesTab() {
  const q = useWorkforcePolicies();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<WorkforcePolicy | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState<WorkforcePolicy | null>(null);

  const del = useApiMutation((p: WorkforcePolicy) => api.delete(`/workforce/policies/${p.id}`), {
    success: (_r, p) => `Policy ${p.name} deleted`,
    invalidate: [["workforce", "policies"], ["departments"]],
  });

  const openEditor = React.useCallback((p: WorkforcePolicy | null) => {
    setEditing(p);
    setEditorOpen(true);
  }, []);

  const onDelete = React.useCallback(
    async (p: WorkforcePolicy) => {
      const count = p.departments?.length ?? p._count?.departments ?? 0;
      const ok = await confirm({
        title: `Delete policy ${p.name}?`,
        description:
          count > 0
            ? `${count} department${count === 1 ? "" : "s"} currently use this policy and will fall back to the default policy.`
            : "Employees without a department policy use the default policy.",
        confirmLabel: "Delete policy",
        destructive: true,
      });
      if (ok) del.mutate(p);
    },
    [confirm, del],
  );

  const rows = React.useMemo(
    () => [...(q.data ?? [])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    [q.data],
  );

  const columns = React.useMemo<ColumnDef<WorkforcePolicy, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Policy",
        accessorFn: (r) => r.name,
        meta: { label: "Policy" },
        cell: ({ row }) => (
          <div className="min-w-[180px] max-w-[320px]">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{row.original.name}</span>
              {row.original.isDefault && <Badge tone="primary">Default</Badge>}
            </div>
            {row.original.description && <div className="truncate text-xs text-muted-foreground">{row.original.description}</div>}
          </div>
        ),
      },
      {
        id: "tracking",
        header: "Tracking",
        enableSorting: false,
        meta: { label: "Tracking" },
        cell: ({ row }) => (
          <Badge tone={row.original.trackingEnabled ? "success" : "unknown"} dot>
            {row.original.trackingEnabled ? "On" : "Off"}
          </Badge>
        ),
      },
      {
        id: "schedule",
        header: "Schedule",
        enableSorting: false,
        meta: { label: "Schedule" },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-xs">
            <div>{scheduleSummary(row.original)}</div>
            <div className="text-muted-foreground">{row.original.timezone}</div>
          </div>
        ),
      },
      {
        id: "screenshots",
        header: "Screenshots",
        enableSorting: false,
        meta: { label: "Screenshots" },
        cell: ({ row }) =>
          row.original.screenshotsEnabled ? (
            <Badge tone="medium">
              <Camera /> Every {row.original.screenshotIntervalMin} min{row.original.screenshotBlur ? " · blurred" : ""}
            </Badge>
          ) : (
            <Badge tone="neutral">
              <CameraOff /> Off
            </Badge>
          ),
      },
      {
        id: "departments",
        header: "Departments",
        enableSorting: false,
        meta: { label: "Departments" },
        cell: ({ row }) => {
          const deps = row.original.departments ?? [];
          const count = deps.length || row.original._count?.departments || 0;
          if (count === 0) return <span className="text-xs text-muted-foreground">{row.original.isDefault ? "All unassigned" : "None"}</span>;
          const names = deps.map((d) => d.name).join(", ");
          return (
            <span className="block max-w-[220px] truncate text-xs" title={names || undefined}>
              <span className="font-medium tabular">{count}</span>
              {names ? ` · ${names}` : ` department${count === 1 ? "" : "s"}`}
            </span>
          );
        },
      },
      {
        id: "version",
        header: "Version",
        accessorFn: (r) => r.version,
        meta: { label: "Version", className: "tabular text-xs" },
        cell: ({ row }) => <span>v{row.original.version}</span>,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-xs" aria-label={`Edit policy ${p.name}`} onClick={() => openEditor(p)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Assign departments to ${p.name}`} onClick={() => setAssigning(p)}>
                <Building2 />
              </Button>
              {p.isDefault ? (
                <SimpleTooltip label="The default policy cannot be deleted">
                  <span>
                    <Button variant="ghost" size="icon-xs" aria-label={`Delete policy ${p.name} (not allowed for the default policy)`} disabled>
                      <Trash2 />
                    </Button>
                  </span>
                </SimpleTooltip>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete policy ${p.name}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => void onDelete(p)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [onDelete, openEditor],
  );

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-primary" />
        <span>
          Each department uses one workforce policy; employees in departments without one use the <span className="font-medium text-foreground">default</span>{" "}
          policy. Changes reach agents on their next check-in (the policy version increases on every save).
        </span>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        getRowId={(r) => r.id}
        onRowClick={(r) => openEditor(r)}
        columnToggle={false}
        maxHeight="none"
        actions={
          <Button size="sm" onClick={() => openEditor(null)}>
            <Plus /> New policy
          </Button>
        }
        empty={{
          icon: ShieldCheck,
          title: "No workforce policies",
          description: "Create a policy to define work hours, tracking and privacy settings. Mark one as default.",
          action: (
            <Button size="sm" onClick={() => openEditor(null)}>
              <Plus /> New policy
            </Button>
          ),
        }}
      />
      <PolicyEditorSheet open={editorOpen} onOpenChange={setEditorOpen} policy={editing} />
      <AssignDepartmentsDialog policy={assigning} onOpenChange={(o) => !o && setAssigning(null)} />
    </div>
  );
}
