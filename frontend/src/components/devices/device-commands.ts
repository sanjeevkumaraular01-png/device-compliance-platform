import type { CommandType, DevicePolicy } from "@/types/api";

export interface CommandPreset {
  type: CommandType;
  label: string;
  description: string;
  /** Requires an explicit confirmation before being queued. */
  confirm?: boolean;
}

/** Commands that can be queued without extra input (UNINSTALL_SOFTWARE needs a name → Software tab). */
export const COMMAND_PRESETS: CommandPreset[] = [
  { type: "COLLECT_INVENTORY", label: "Collect inventory", description: "Agent sends a full inventory & security report now" },
  { type: "APPLY_POLICY", label: "Apply policy", description: "Agent re-fetches and enforces its effective policy" },
  { type: "INSTALL_PATCHES", label: "Install patches", description: "Critical & important patches, reboot if required" },
  { type: "REFRESH_USB_RULES", label: "Refresh USB rules", description: "Re-sync the USB whitelist and block rules" },
  { type: "ENABLE_ENCRYPTION", label: "Enable encryption", description: "Turn on BitLocker / FileVault / LUKS" },
  { type: "LOCK_SCREEN", label: "Lock screen", description: "Lock the interactive session immediately" },
  { type: "RESTART", label: "Restart", description: "Reboot the device in 60 seconds", confirm: true },
];

export const commandLabel = (type: CommandType): string =>
  COMMAND_PRESETS.find((p) => p.type === type)?.label ?? (type === "UNINSTALL_SOFTWARE" ? "Uninstall software" : type);

/** Builds the documented payload for a command type. */
export function commandPayload(type: CommandType, opts: { policyVersion?: number | null } = {}): Record<string, unknown> {
  switch (type) {
    case "RESTART":
      return { delaySec: 60 };
    case "INSTALL_PATCHES":
      return { severity: ["CRITICAL", "IMPORTANT"], reboot: "if-required" };
    case "APPLY_POLICY":
      return opts.policyVersion != null ? { version: opts.policyVersion } : {};
    default:
      return {};
  }
}

/** Looks up a device's assigned policy version from the cached policy list (if loaded). */
export function policyVersionFor(policyId: string | null | undefined, policies: DevicePolicy[] | undefined): number | null {
  if (!policyId || !policies) return null;
  return policies.find((p) => p.id === policyId)?.version ?? null;
}
