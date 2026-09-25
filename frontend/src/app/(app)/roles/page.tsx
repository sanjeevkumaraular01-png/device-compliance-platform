"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, KeyRound, Lock, RotateCcw, Save, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { normalizeList } from "@/hooks/use-list-query";
import { useAuth } from "@/lib/auth";
import { api, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ROLE_KEYS, type Paginated, type Role } from "@/types/api";
import { roleMeta } from "@/components/users/role-meta";
import { PermissionMatrix, groupPermissions } from "@/components/roles/permission-matrix";
import { toneDot } from "@/lib/status";

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export default function RolesPage() {
  const { can, reload } = useAuth();
  const editable = can("roles:write");
  const qc = useQueryClient();

  const rolesQuery = useQuery({
    queryKey: ["roles", "list"],
    queryFn: async ({ signal }) => normalizeList(await api.get<Paginated<Role> | Role[]>("/roles", undefined, { signal })).data,
  });
  const permsQuery = useQuery({
    queryKey: ["roles", "permissions"],
    queryFn: ({ signal }) => api.get<string[]>("/roles/permissions", undefined, { signal }),
    staleTime: 10 * 60_000,
  });

  const roles = React.useMemo(() => {
    const order = (k: string) => {
      const i = (ROLE_KEYS as readonly string[]).indexOf(k);
      return i === -1 ? 99 : i;
    };
    return [...(rolesQuery.data ?? [])].sort((a, b) => order(a.key) - order(b.key));
  }, [rolesQuery.data]);

  const allPermissions = React.useMemo(() => {
    const set = new Set<string>(Array.isArray(permsQuery.data) ? permsQuery.data : []);
    for (const r of roles) for (const p of r.permissions ?? []) set.add(p);
    return Array.from(set);
  }, [permsQuery.data, roles]);
  const groups = React.useMemo(() => groupPermissions(allPermissions), [allPermissions]);

  const saved = React.useMemo(() => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions ?? [])])) as Record<string, Set<string>>, [roles]);

  // Draft edits per role id (only roles that were touched).
  const [draft, setDraft] = React.useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = React.useState(false);

  const granted = React.useMemo(() => ({ ...saved, ...draft }), [saved, draft]);

  const changedRoleIds = React.useMemo(
    () => Object.keys(draft).filter((id) => saved[id] && !sameSet(draft[id], saved[id])),
    [draft, saved],
  );

  const dirtyCells = React.useMemo(() => {
    const cells = new Set<string>();
    for (const id of changedRoleIds) {
      const a = saved[id];
      const b = draft[id];
      for (const p of allPermissions) if (a.has(p) !== b.has(p)) cells.add(`${id}|${p}`);
    }
    return cells;
  }, [changedRoleIds, saved, draft, allPermissions]);

  const setRolePerms = (role: Role, update: (s: Set<string>) => void) => {
    setDraft((d) => {
      const next = new Set(d[role.id] ?? saved[role.id] ?? []);
      update(next);
      return { ...d, [role.id]: next };
    });
  };

  const onToggle = (role: Role, permission: string, value: boolean) =>
    setRolePerms(role, (s) => {
      if (value) s.add(permission);
      else s.delete(permission);
    });

  const onToggleGroup = (role: Role, permissions: string[], value: boolean) =>
    setRolePerms(role, (s) => permissions.forEach((p) => (value ? s.add(p) : s.delete(p))));

  // Warn before leaving with unsaved changes.
  React.useEffect(() => {
    if (changedRoleIds.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [changedRoleIds.length]);

  const onSave = async () => {
    setSaving(true);
    const results = await Promise.allSettled(
      changedRoleIds.map((id) => api.patch<Role>(`/roles/${id}`, { permissions: Array.from(draft[id]).sort() }).then(() => id)),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map((r) => r.value);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    setDraft((d) => {
      const next = { ...d };
      for (const id of ok) delete next[id];
      return next;
    });
    await qc.invalidateQueries({ queryKey: ["roles"] });
    void reload(); // the current user's own permissions may have changed
    setSaving(false);
    if (ok.length) toast.success(`Permissions updated for ${ok.length} role${ok.length === 1 ? "" : "s"}`);
    if (failed.length) toast.error(`Failed to update ${failed.length} role${failed.length === 1 ? "" : "s"}`, { description: errorMessage(failed[0].reason) });
  };

  const onDiscard = () => setDraft({});

  const loading = rolesQuery.isLoading || permsQuery.isLoading;
  const error = rolesQuery.error ?? permsQuery.error;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        icon={KeyRound}
        description="Role-based access control. Each role grants a set of resource:action permissions to its users."
        actions={
          editable && changedRoleIds.length > 0 ? (
            <>
              <Button variant="outline" onClick={onDiscard} disabled={saving}>
                <RotateCcw /> Discard
              </Button>
              <Button onClick={onSave} loading={saving}>
                {!saving && <Save />} Save changes ({changedRoleIds.length})
              </Button>
            </>
          ) : undefined
        }
      />

      {error ? (
        <Card>
          <ErrorState
            error={error}
            onRetry={() => {
              void rolesQuery.refetch();
              void permsQuery.refetch();
            }}
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            {loading
              ? Array.from({ length: 7 }).map((_, i) => <CardSkeleton key={i} />)
              : roles.map((r) => {
                  const m = roleMeta[r.key];
                  const count = r.key === "SUPER_ADMIN" ? allPermissions.length : (granted[r.id]?.size ?? 0);
                  const changed = changedRoleIds.includes(r.id);
                  return (
                    <Card key={r.id} className={cn("flex min-w-0 flex-col gap-2 p-3", changed && "border-primary/60 ring-1 ring-primary/30")}>
                      <div className="flex items-start gap-2">
                        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneDot[m?.tone ?? "neutral"])} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                            {r.name || m?.label}
                            {r.key === "SUPER_ADMIN" && <Lock className="size-3 text-muted-foreground" aria-label="Locked" />}
                          </p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{r.description || m?.description}</p>
                        </div>
                      </div>
                      <div className="mt-auto flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="tabular-nums">
                          <KeyRound /> {formatNumber(count)} / {formatNumber(allPermissions.length)}
                        </Badge>
                        {r._count?.users !== undefined && (
                          <Badge variant="outline" className="tabular-nums">
                            <Users /> {formatNumber(r._count.users)}
                          </Badge>
                        )}
                        {changed && <Badge tone="primary">Modified</Badge>}
                      </div>
                    </Card>
                  );
                })}
          </div>

          {!loading && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                editable ? "border-info/30 bg-info/10" : "bg-muted/50 text-muted-foreground",
              )}
            >
              <Info className={cn("mt-0.5 size-3.5 shrink-0", editable ? "text-info" : "")} />
              {editable ? (
                <span>
                  Changes take effect at each user&apos;s next token refresh (within 15 minutes). The Super Admin role always holds every permission and
                  cannot be edited.
                </span>
              ) : (
                <span>Read-only view. Only a Super Admin can change role permissions.</span>
              )}
            </div>
          )}

          {loading ? (
            <Card>
              <TableSkeleton rows={10} cols={8} />
            </Card>
          ) : roles.length === 0 ? (
            <Card>
              <EmptyState icon={KeyRound} title="No roles found" description="Roles are seeded by the backend on first start." />
            </Card>
          ) : (
            <PermissionMatrix
              roles={roles}
              groups={groups}
              granted={granted}
              dirtyCells={dirtyCells}
              editable={editable && !saving}
              onToggle={onToggle}
              onToggleGroup={onToggleGroup}
            />
          )}
        </div>
      )}
    </>
  );
}
