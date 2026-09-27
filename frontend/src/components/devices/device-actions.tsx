"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ChevronDown,
  ClipboardCheck,
  Download,
  Ellipsis,
  HardDrive,
  Lock,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Usb,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/common/confirm-dialog";
import { UsbRequestDialog } from "@/components/usb/usb-request-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { usePolicies } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { CommandType, ComplianceResult, DeviceCommand, DeviceDetail } from "@/types/api";
import { AssignUserDialog, EditDeviceSheet } from "@/components/devices/device-dialogs";
import { commandLabel, commandPayload, policyVersionFor } from "@/components/devices/device-commands";

const RUN_MENU: { type: CommandType; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "COLLECT_INVENTORY", icon: RefreshCw },
  { type: "LOCK_SCREEN", icon: Lock },
  { type: "RESTART", icon: Power },
  { type: "SHUTDOWN", icon: PowerOff },
  { type: "INSTALL_PATCHES", icon: Download },
  { type: "APPLY_POLICY", icon: ScrollText },
  { type: "ENABLE_ENCRYPTION", icon: HardDrive },
];

/** Defer opening a dialog until the dropdown menu has finished closing (avoids Radix focus/pointer-events races). */
const defer = (fn: () => void) => () => {
  setTimeout(fn, 0);
};

export function DeviceActions({ device, onCommandQueued }: { device: DeviceDetail; onCommandQueued?: () => void }) {
  const router = useRouter();
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const canCommand = can("devices:command");
  const canWrite = can("devices:write");
  const canEvaluate = can(["compliance:write", "devices:command"]);
  const canUsbRequest = can("usb:request") && user?.role === "EMPLOYEE";
  const policies = usePolicies(canCommand);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [usbOpen, setUsbOpen] = React.useState(false);

  const quarantined = device.status === "QUARANTINED";
  const retired = device.status === "RETIRED";

  const command = useApiMutation(
    (vars: { type: CommandType; payload: Record<string, unknown> }) => api.post<DeviceCommand>(`/devices/${device.id}/commands`, vars),
    {
      success: (_c, v) => `${commandLabel(v.type)} queued — delivered on the next agent check-in`,
      invalidate: [["devices", device.id, "commands"], ["devices", device.id, "timeline"]],
      onSuccess: () => onCommandQueued?.(),
    },
  );

  const evaluate = useApiMutation(() => api.post<ComplianceResult>(`/devices/${device.id}/evaluate`), {
    success: (r) => (r && typeof r.score === "number" ? `Compliance re-evaluated — score ${r.score}` : "Compliance re-evaluated"),
    invalidate: [["devices"], ["compliance"], ["dashboard"]],
  });

  const quarantine = useApiMutation(() => api.post(`/devices/${device.id}/quarantine`), {
    success: `${device.deviceName} quarantined`,
    invalidate: [["devices"]],
  });
  const release = useApiMutation(() => api.post(`/devices/${device.id}/release`), {
    success: `${device.deviceName} released from quarantine`,
    invalidate: [["devices"]],
  });

  const retire = useApiMutation(() => api.delete(`/devices/${device.id}`), {
    success: `${device.deviceName} retired — agent token and certificates revoked`,
    invalidate: [["devices"], ["dashboard"]],
    onSuccess: () => router.push("/devices"),
  });

  const runCommand = async (type: CommandType) => {
    if (type === "RESTART" || type === "SHUTDOWN") {
      const shutdown = type === "SHUTDOWN";
      const ok = await confirm({
        title: `${shutdown ? "Shut down" : "Restart"} ${device.deviceName}?`,
        description: `The device ${shutdown ? "powers off" : "reboots"} 60 seconds after the agent receives the command. The signed-in user may lose unsaved work.`,
        confirmLabel: shutdown ? "Shut down device" : "Restart device",
        destructive: true,
      });
      if (!ok) return;
    }
    command.mutate({ type, payload: commandPayload(type, { policyVersion: policyVersionFor(device.policyId, policies.data) }) });
  };

  const onQuarantine = async () => {
    const ok = await confirm({
      title: `Quarantine ${device.deviceName}?`,
      description:
        "The device is isolated: it is marked non-trusted, flagged in compliance reports and restricted by policy until it is released. The user will be notified by the agent.",
      confirmLabel: "Quarantine",
      destructive: true,
    });
    if (ok) quarantine.mutate();
  };

  const onRetire = async () => {
    const ok = await confirm({
      title: `Retire ${device.deviceName}?`,
      description:
        "The device is marked Retired, its agent token and certificates are revoked, and it stops reporting. Historical data is kept for audit. This cannot be undone from the console.",
      confirmLabel: "Retire device",
      destructive: true,
      typeToConfirm: device.deviceName,
    });
    if (ok) retire.mutate();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCommand && !retired && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" loading={command.isPending}>
              <SquareTerminal /> Run command <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Remote actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {RUN_MENU.map(({ type, icon: Icon }) => (
              <DropdownMenuItem key={type} destructive={type === "RESTART" || type === "SHUTDOWN"} onSelect={defer(() => void runCommand(type))}>
                <Icon /> {commandLabel(type)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {canEvaluate && !retired && (
        <Button variant="outline" size="sm" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>
          <ClipboardCheck /> Evaluate now
        </Button>
      )}

      {canCommand &&
        !retired &&
        (quarantined ? (
          <Button variant="outline" size="sm" loading={release.isPending} onClick={() => release.mutate()}>
            <ShieldCheck /> Release
          </Button>
        ) : (
          <Button variant="outline" size="sm" loading={quarantine.isPending} onClick={() => void onQuarantine()} className="text-destructive hover:text-destructive">
            <ShieldAlert /> Quarantine
          </Button>
        ))}

      {canUsbRequest && !retired && (
        <>
          <Button variant="outline" size="sm" onClick={() => setUsbOpen(true)}>
            <Usb /> Request USB access
          </Button>
          <UsbRequestDialog open={usbOpen} onOpenChange={setUsbOpen} defaultDeviceId={device.id} />
        </>
      )}

      {canWrite && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={defer(() => setEditOpen(true))}>
                <Pencil /> Edit details
              </DropdownMenuItem>
              {!retired && (
                <DropdownMenuItem onSelect={defer(() => setAssignOpen(true))}>
                  <UserPlus /> {device.assignedUser ? "Reassign user" : "Assign user"}
                </DropdownMenuItem>
              )}
              {!retired && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={defer(() => void onRetire())}>
                    <Archive /> Retire device
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <EditDeviceSheet device={device} open={editOpen} onOpenChange={setEditOpen} />
          <AssignUserDialog device={device} open={assignOpen} onOpenChange={setAssignOpen} />
        </>
      )}
    </div>
  );
}
