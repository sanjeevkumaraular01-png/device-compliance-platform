"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/api";
import { roleMeta } from "@/components/users/role-meta";

export interface PermissionGroup {
  resource: string;
  permissions: string[];
}

export function groupPermissions(all: string[]): PermissionGroup[] {
  const map = new Map<string, string[]>();
  for (const p of all) {
    const [resource] = p.split(":");
    const list = map.get(resource) ?? [];
    list.push(p);
    map.set(resource, list);
  }
  return Array.from(map.entries()).map(([resource, permissions]) => ({ resource, permissions }));
}

const RESOURCE_LABELS: Record<string, string> = {
  usb: "USB",
  dashboard: "Dashboard",
  devices: "Devices",
  enrollment: "Enrollment",
  policies: "Policies",
  software: "Software",
  security: "Security",
  patches: "Patches",
  compliance: "Compliance",
  alerts: "Alerts",
  reports: "Reports",
  audit: "Audit",
  users: "Users",
  roles: "Roles",
  settings: "Settings",
};

export function resourceLabel(resource: string) {
  return RESOURCE_LABELS[resource] ?? humanize(resource);
}

export function PermissionMatrix({
  roles,
  groups,
  granted,
  dirtyCells,
  editable,
  onToggle,
  onToggleGroup,
}: {
  roles: Role[];
  groups: PermissionGroup[];
  /** role id → granted permission set (draft or saved) */
  granted: Record<string, Set<string>>;
  dirtyCells: Set<string>;
  editable: boolean;
  onToggle: (role: Role, permission: string, value: boolean) => void;
  onToggleGroup: (role: Role, permissions: string[], value: boolean) => void;
}) {
  const locked = (r: Role) => r.key === "SUPER_ADMIN";

  return (
    <div className="overflow-auto rounded-lg border bg-card shadow-xs scrollbar-thin" style={{ maxHeight: "max(24rem, calc(100dvh - 22rem))" }}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-30 min-w-[11rem] border-b border-r bg-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:min-w-[14rem]"
            >
              Permission
            </th>
            {roles.map((r) => (
              <th
                key={r.id}
                scope="col"
                className="sticky top-0 z-20 min-w-[5.5rem] border-b bg-muted px-2 py-2 text-center align-bottom text-[11px] font-semibold leading-tight text-muted-foreground"
              >
                <span className="flex flex-col items-center gap-0.5">
                  {locked(r) && <Lock className="size-3" aria-label="Locked" />}
                  <span className="whitespace-normal">{r.name || roleMeta[r.key]?.label || r.key}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.resource}>
              <tr>
                <th
                  scope="rowgroup"
                  className="sticky left-0 z-10 border-b border-r bg-secondary px-3 py-1.5 text-left text-xs font-semibold"
                >
                  {resourceLabel(g.resource)}
                  <span className="ml-1.5 font-normal text-muted-foreground">({g.permissions.length})</span>
                </th>
                {roles.map((r) => {
                  const count = g.permissions.filter((p) => granted[r.id]?.has(p)).length;
                  const state = count === 0 ? false : count === g.permissions.length ? true : "indeterminate";
                  const disabled = !editable || locked(r);
                  return (
                    <td key={r.id} className="border-b bg-secondary px-2 py-1.5 text-center">
                      <SimpleTooltip label={disabled ? undefined : `Toggle all ${resourceLabel(g.resource)} permissions for ${r.name}`}>
                        <span className="inline-flex">
                          <Checkbox
                            checked={locked(r) ? true : state}
                            disabled={disabled}
                            onCheckedChange={(v) => onToggleGroup(r, g.permissions, v === true)}
                            aria-label={`All ${resourceLabel(g.resource)} permissions for ${r.name}`}
                          />
                        </span>
                      </SimpleTooltip>
                    </td>
                  );
                })}
              </tr>
              {g.permissions.map((p) => (
                <tr key={p} className="group">
                  <th scope="row" className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 text-left font-normal group-hover:bg-accent">
                    <span className="block font-mono text-xs">{p}</span>
                  </th>
                  {roles.map((r) => {
                    const checked = locked(r) || !!granted[r.id]?.has(p);
                    const dirty = dirtyCells.has(`${r.id}|${p}`);
                    return (
                      <td
                        key={r.id}
                        className={cn("border-b px-2 py-1.5 text-center group-hover:bg-accent/60", dirty && "bg-primary/10 group-hover:bg-primary/15")}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!editable || locked(r)}
                          onCheckedChange={(v) => onToggle(r, p, v === true)}
                          aria-label={`${p} for ${r.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
