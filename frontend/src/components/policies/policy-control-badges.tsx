"use client";

import * as React from "react";
import { BrickWall, HardDrive, Lock, Radar, ShieldCheck, Timer, Usb } from "lucide-react";
import type { DevicePolicy } from "@/types/api";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Control {
  key: string;
  on: boolean;
  label: string;
  offLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  text?: string;
}

function controls(p: DevicePolicy): Control[] {
  return [
    { key: "usb", on: p.usbStorageBlocked, label: "USB storage blocked", offLabel: "USB storage allowed", icon: Usb },
    { key: "enc", on: p.requireDiskEncryption, label: "Disk encryption required", offLabel: "Disk encryption not required", icon: HardDrive },
    { key: "av", on: p.requireAntivirus, label: "Antivirus required", offLabel: "Antivirus not required", icon: ShieldCheck },
    { key: "edr", on: p.requireEdr, label: "EDR required", offLabel: "EDR not required", icon: Radar },
    { key: "fw", on: p.requireFirewall, label: "Firewall required", offLabel: "Firewall not required", icon: BrickWall },
    {
      key: "lock",
      on: p.screenLockEnabled,
      label: `Screen lock after ${Math.round(p.screenLockTimeoutSec / 60)} min`,
      offLabel: "Screen lock not enforced",
      icon: p.screenLockEnabled ? Timer : Lock,
      text: p.screenLockEnabled ? `${Math.round(p.screenLockTimeoutSec / 60)}m` : undefined,
    },
  ];
}

/** Compact icon strip summarising the key enforcement toggles of a policy. */
export function PolicyControlBadges({ policy, className }: { policy: DevicePolicy; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {controls(policy).map((c) => {
        const Icon = c.icon;
        return (
          <SimpleTooltip key={c.key} label={c.on ? c.label : c.offLabel}>
            <span
              tabIndex={0}
              aria-label={c.on ? c.label : c.offLabel}
              className={cn(
                "inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-medium ring-1 ring-inset",
                c.on ? "bg-primary/10 text-primary ring-primary/25" : "bg-muted text-muted-foreground/60 ring-border",
              )}
            >
              <Icon className="size-3.5" />
              {c.text}
            </span>
          </SimpleTooltip>
        );
      })}
    </div>
  );
}
