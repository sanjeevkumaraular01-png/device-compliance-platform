"use client";

import { Info, ShieldCheck, ShieldOff } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyValueGrid } from "@/components/common/misc";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { initials } from "@/lib/utils";
import { roleMeta } from "@/components/users/role-meta";
import { authProviderLabel } from "@/components/audit/audit-meta";

export function ProfileTab() {
  const { user } = useAuth();
  if (!user) return null;
  const role = roleMeta[user.role];

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">{initials(user.displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{user.displayName}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={role?.tone ?? "neutral"}>{user.roleName || role?.label || user.role}</Badge>
              {user.mfaEnabled ? (
                <Badge tone="success">
                  <ShieldCheck /> MFA enabled
                </Badge>
              ) : (
                <Badge tone="medium">
                  <ShieldOff /> MFA not enabled
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>Your identity as seen by the console.</CardDescription>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            items={[
              { label: "Display name", value: user.displayName },
              { label: "Email", value: user.email },
              { label: "Role", value: user.roleName || role?.label },
              { label: "Department", value: user.departmentName ?? "Not assigned" },
              { label: "Sign-in method", value: authProviderLabel[user.authProvider] ?? user.authProvider },
              {
                label: "Last sign-in",
                value: user.lastLoginAt ? (
                  <span title={formatDateTime(user.lastLoginAt)}>
                    {formatDateTime(user.lastLoginAt)} <span className="text-muted-foreground">({formatRelative(user.lastLoginAt)})</span>
                  </span>
                ) : (
                  "First session"
                ),
              },
              { label: "User ID", value: user.id, mono: true },
              { label: "Permissions", value: `${user.permissions.length} granted by role` },
            ]}
          />
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Profile details, role and department are managed by an administrator
          {user.authProvider !== "LOCAL" ? " or synchronized from your organization's directory" : ""}. Contact your IT administrator to request
          changes.
        </span>
      </div>
    </div>
  );
}
