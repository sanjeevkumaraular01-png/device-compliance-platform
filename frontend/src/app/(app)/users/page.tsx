"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FileUp, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, Unlock, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/data-table/data-table";
import { ClearFiltersButton, FilterSelect, enumOptions } from "@/components/data-table/filters";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useListQuery } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { initials } from "@/lib/utils";
import { ROLE_KEYS, type User } from "@/types/api";
import { roleMeta, userStatus, userStatusMeta } from "@/components/users/role-meta";
import { CreateUserDialog, EditUserSheet } from "@/components/users/user-dialogs";
import { UsersImportDialog } from "@/components/users/users-import-dialog";
import { authProviderLabel } from "@/components/audit/audit-meta";

type UserAction = "reset-mfa" | "unlock" | "deactivate" | "reactivate";

export default function UsersPage() {
  const { can, user: me } = useAuth();
  const canWrite = can("users:write");
  const confirm = useConfirm();
  const departments = useDepartments();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<User | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  const list = useListQuery<User>("users", "/users", { initial: { sortBy: "displayName", sortOrder: "asc" } });
  const f = list.state.filters;

  const { mutate: runAction } = useApiMutation(
    ({ user, action }: { user: User; action: UserAction }) => {
      switch (action) {
        case "reset-mfa":
          return api.post(`/users/${user.id}/reset-mfa`);
        case "unlock":
          return api.post(`/users/${user.id}/unlock`);
        case "deactivate":
          return api.delete(`/users/${user.id}`);
        case "reactivate":
          return api.patch(`/users/${user.id}`, { isActive: true });
      }
    },
    {
      success: (_d, { user, action }) =>
        ({
          "reset-mfa": `MFA reset for ${user.displayName}`,
          unlock: `${user.displayName} unlocked`,
          deactivate: `${user.displayName} deactivated`,
          reactivate: `${user.displayName} reactivated`,
        })[action],
      invalidate: [["users"]],
    },
  );

  const openEdit = React.useCallback((u: User) => {
    setEditing(u);
    setEditOpen(true);
  }, []);

  const onAction = React.useCallback(
    async (user: User, action: UserAction) => {
      if (action === "reset-mfa") {
        const ok = await confirm({
          title: `Reset MFA for ${user.displayName}?`,
          description: "Their authenticator and recovery codes will be removed. They must enrol again at next sign-in if MFA is required for their role.",
          confirmLabel: "Reset MFA",
          destructive: true,
        });
        if (!ok) return;
      }
      if (action === "deactivate") {
        const ok = await confirm({
          title: `Deactivate ${user.displayName}?`,
          description: "The user will be signed out of all sessions and can no longer sign in. Their audit history is preserved and the account can be reactivated later.",
          confirmLabel: "Deactivate",
          destructive: true,
        });
        if (!ok) return;
      }
      runAction({ user, action });
    },
    [confirm, runAction],
  );

  const columns = React.useMemo<ColumnDef<User, unknown>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: "User",
        meta: { label: "User" },
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="size-7">
                <AvatarFallback className="text-[11px]">{initials(u.displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="max-w-[14rem] truncate font-medium">
                  {u.displayName}
                  {me?.id === u.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                </p>
                <p className="max-w-[14rem] truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "Role",
        enableSorting: false,
        meta: { label: "Role" },
        cell: ({ row }) => {
          const key = row.original.role?.key;
          if (!key) return <span className="text-muted-foreground">—</span>;
          const m = roleMeta[key];
          return <Badge tone={m?.tone ?? "neutral"}>{row.original.role?.name ?? m?.label ?? key}</Badge>;
        },
      },
      {
        id: "department",
        header: "Department",
        enableSorting: false,
        meta: { label: "Department" },
        cell: ({ row }) =>
          row.original.department ? (
            <span className="block max-w-[10rem] truncate text-xs">{row.original.department.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "authProvider",
        header: "Sign-in",
        enableSorting: false,
        meta: { label: "Auth provider" },
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{authProviderLabel[row.original.authProvider] ?? row.original.authProvider}</span>,
      },
      {
        accessorKey: "mfaEnabled",
        header: "MFA",
        enableSorting: false,
        meta: { label: "MFA" },
        cell: ({ row }) =>
          row.original.mfaEnabled ? (
            <Badge tone="success">
              <ShieldCheck /> Enabled
            </Badge>
          ) : (
            <Badge tone="unknown">
              <ShieldOff /> Off
            </Badge>
          ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        meta: { label: "Status" },
        cell: ({ row }) => {
          const s = userStatus(row.original);
          const m = userStatusMeta[s];
          const badge = (
            <Badge tone={m.tone} dot>
              {m.label}
            </Badge>
          );
          return s === "LOCKED" ? (
            <SimpleTooltip label={`Locked until ${formatDateTime(row.original.lockedUntil)} after ${row.original.failedLoginCount} failed attempts`}>
              <span tabIndex={0}>{badge}</span>
            </SimpleTooltip>
          ) : (
            badge
          );
        },
      },
      {
        accessorKey: "lastLoginAt",
        header: "Last sign-in",
        meta: { label: "Last sign-in" },
        cell: ({ row }) => (
          <div className="text-xs">
            <RelativeTime value={row.original.lastLoginAt} />
            {row.original.lastLoginIp && <p className="font-mono text-[11px] text-muted-foreground">{row.original.lastLoginIp}</p>}
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) => {
          if (!canWrite) return null;
          const u = row.original;
          const s = userStatus(u);
          const isSelf = me?.id === u.id;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${u.displayName}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="truncate">{u.displayName}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openEdit(u)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  {u.mfaEnabled && (
                    <DropdownMenuItem onSelect={() => onAction(u, "reset-mfa")}>
                      <ShieldOff /> Reset MFA
                    </DropdownMenuItem>
                  )}
                  {s === "LOCKED" && (
                    <DropdownMenuItem onSelect={() => onAction(u, "unlock")}>
                      <Unlock /> Unlock
                    </DropdownMenuItem>
                  )}
                  {!u.isActive && (
                    <DropdownMenuItem onSelect={() => onAction(u, "reactivate")}>
                      <UserCheck /> Reactivate
                    </DropdownMenuItem>
                  )}
                  {u.isActive && !isSelf && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => onAction(u, "deactivate")}>
                        <UserX /> Deactivate
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [canWrite, me?.id, onAction, openEdit],
  );

  return (
    <>
      <PageHeader
        title="Users"
        icon={Users}
        description="Console accounts, their roles, departments and sign-in security."
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp /> Import CSV
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus /> Add user
              </Button>
            </div>
          ) : undefined
        }
      />

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
        getRowId={(u) => u.id}
        onRowClick={canWrite ? openEdit : undefined}
        rowClassName={(u) => (u.isActive ? undefined : "opacity-60")}
        search={{ value: list.state.search, onChange: list.setSearch, placeholder: "Search name or email…" }}
        filters={
          <>
            <FilterSelect
              label="Role"
              value={f.roleKey as string | undefined}
              onChange={(v) => list.setFilter("roleKey", v)}
              options={enumOptions(ROLE_KEYS, (k) => roleMeta[k].label)}
            />
            <FilterSelect
              label="Department"
              value={f.departmentId as string | undefined}
              onChange={(v) => list.setFilter("departmentId", v)}
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            />
            <FilterSelect
              label="Status"
              value={f.isActive === undefined ? undefined : String(f.isActive)}
              onChange={(v) => list.setFilter("isActive", v === undefined ? undefined : v === "true")}
              options={[
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ]}
            />
            <ClearFiltersButton count={list.activeFilterCount} onClear={list.clearFilters} />
          </>
        }
        empty={{
          icon: Users,
          title: "No users found",
          description: list.activeFilterCount || list.state.search ? "Try adjusting the search or filters." : "Add the first console user to get started.",
        }}
      />

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <UsersImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <EditUserSheet user={editing} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
