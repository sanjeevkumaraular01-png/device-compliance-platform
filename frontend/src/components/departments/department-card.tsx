"use client";

import { Laptop, Pencil, ShieldHalf, Trash2, UserRound, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Department } from "@/types/api";

/** Stable accent per department so the same team always gets the same colour. */
const ACCENTS = [
  "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
  "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  "bg-teal-500/12 text-teal-700 dark:text-teal-300",
];

export function departmentAccent(code: string): string {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function departmentUsers(d: Department): number | undefined {
  return d.userCount ?? d._count?.users;
}

export function departmentDevices(d: Department): number | undefined {
  return d.deviceCount ?? d._count?.devices;
}

export function DepartmentCard({
  department: d,
  canWrite,
  onEdit,
  onDelete,
}: {
  department: Department;
  canWrite: boolean;
  onEdit: (d: Department) => void;
  onDelete: (d: Department) => void;
}) {
  const users = departmentUsers(d);
  const devices = departmentDevices(d);

  return (
    <article
      className={cn(
        "group relative flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-xs transition",
        canWrite && "cursor-pointer hover:border-primary/40 hover:shadow-md focus-within:border-primary/40",
      )}
      onClick={canWrite ? () => onEdit(d) : undefined}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg text-sm font-semibold", departmentAccent(d.code))}>
          {initials(d.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{d.name}</h3>
            <span className="shrink-0 rounded border bg-muted/50 px-1.5 py-px font-mono text-[10px] text-muted-foreground">{d.code}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-xs text-muted-foreground">{d.description || "No description"}</p>
        </div>
        {canWrite && (
          <div
            className="flex shrink-0 gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <SimpleTooltip label="Edit">
              <Button variant="ghost" size="icon-xs" aria-label={`Edit ${d.name}`} onClick={() => onEdit(d)}>
                <Pencil />
              </Button>
            </SimpleTooltip>
            <SimpleTooltip label="Delete">
              <Button variant="ghost" size="icon-xs" aria-label={`Delete ${d.name}`} onClick={() => onDelete(d)}>
                <Trash2 />
              </Button>
            </SimpleTooltip>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat icon={Users} label="Employees" value={users} />
        <Stat icon={Laptop} label="Devices" value={devices} />
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t pt-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Manager</span>
          {d.manager ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar className="size-5">
                <AvatarFallback className="text-[9px]">{initials(d.manager.displayName)}</AvatarFallback>
              </Avatar>
              <span className="truncate font-medium" title={d.manager.email}>
                {d.manager.displayName}
              </span>
            </span>
          ) : canWrite ? (
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1 font-medium text-sev-medium hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(d);
              }}
            >
              <UserRound className="size-3" /> Assign manager
            </button>
          ) : (
            <span className="flex items-center gap-1 text-sev-medium">
              <UserRound className="size-3" /> Not assigned
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Device policy</span>
          <span className={cn("flex min-w-0 items-center gap-1 truncate", d.policy ? "font-medium text-primary" : "text-muted-foreground")}>
            <ShieldHalf className="size-3 shrink-0" />
            <span className="truncate">{d.policy?.name ?? "Default"}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value === undefined ? "—" : formatNumber(value)}</div>
    </div>
  );
}
