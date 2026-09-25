import type { DevicePolicy, PolicyInput } from "@/types/api";

/** Fields editable in the console (isDefault is managed server-side, extraSettings is left untouched). */
export type PolicyEditable = Omit<PolicyInput, "isDefault" | "extraSettings">;

/** Defaults mirror the `DevicePolicy` model in backend/prisma/schema.prisma. */
export const POLICY_DEFAULTS: PolicyEditable = {
  name: "",
  description: null,
  priority: 100,
  companyDataOnlyManaged: true,
  usbStorageBlocked: true,
  allowWhitelistedUsb: true,
  usbReadOnly: false,
  blockUnauthorizedSoftware: true,
  autoUninstallBlacklisted: false,
  requireAntivirus: true,
  requireEdr: true,
  requireFirewall: true,
  requireDiskEncryption: true,
  requireSecureBoot: false,
  maxAvSignatureAgeDays: 3,
  autoUpdateEnabled: true,
  autoPatchDeployment: true,
  patchDeadlineDays: 14,
  maintenanceWindow: null,
  screenLockEnabled: true,
  screenLockTimeoutSec: 300,
  requirePasswordOnWake: true,
  screenSaverEnforced: true,
  checkinIntervalSec: 300,
  inventoryIntervalSec: 3600,
};

export const EDITABLE_KEYS = Object.keys(POLICY_DEFAULTS) as (keyof PolicyEditable)[];

export function pickEditable(p: DevicePolicy): PolicyEditable {
  const out = { ...POLICY_DEFAULTS };
  for (const k of EDITABLE_KEYS) {
    const v = p[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export type BoolKey = {
  [K in keyof PolicyEditable]: PolicyEditable[K] extends boolean ? K : never;
}[keyof PolicyEditable];

export interface ToggleDef {
  key: BoolKey;
  label: string;
  help: string;
  /** Compliance rule(s) this setting drives. */
  rules?: string[];
}

export const TOGGLES: Record<BoolKey, ToggleDef> = {
  companyDataOnlyManaged: {
    key: "companyDataOnlyManaged",
    label: "Company data only on managed devices",
    help: "Only company-owned, enrolled devices may access corporate data. Personal (BYOD) devices are flagged non-compliant.",
    rules: ["NOT_COMPANY_DEVICE"],
  },
  usbStorageBlocked: {
    key: "usbStorageBlocked",
    label: "Block USB mass storage",
    help: "The agent blocks removable storage devices. HID, audio and printers are not affected.",
    rules: ["USB_STORAGE_ENABLED"],
  },
  allowWhitelistedUsb: {
    key: "allowWhitelistedUsb",
    label: "Allow whitelisted USB devices",
    help: "Storage devices on the USB whitelist (or with an approved access request) are still permitted when storage is blocked.",
  },
  usbReadOnly: {
    key: "usbReadOnly",
    label: "Mount permitted USB storage read-only",
    help: "Allowed storage devices are mounted read-only to prevent data exfiltration.",
  },
  blockUnauthorizedSoftware: {
    key: "blockUnauthorizedSoftware",
    label: "Block unauthorized software",
    help: "Software not on the whitelist is classified UNAUTHORIZED (instead of unclassified) and counts against compliance.",
    rules: ["UNAUTHORIZED_SOFTWARE"],
  },
  autoUninstallBlacklisted: {
    key: "autoUninstallBlacklisted",
    label: "Auto-uninstall blacklisted software",
    help: "The agent automatically removes software matching a blacklist entry and records it in the audit log.",
  },
  requireAntivirus: {
    key: "requireAntivirus",
    label: "Require antivirus",
    help: "An active antivirus product with current signatures must be running.",
    rules: ["ANTIVIRUS_MISSING", "ANTIVIRUS_OUTDATED"],
  },
  requireEdr: {
    key: "requireEdr",
    label: "Require EDR",
    help: "An endpoint detection & response sensor must be installed and running.",
    rules: ["EDR_MISSING"],
  },
  requireFirewall: {
    key: "requireFirewall",
    label: "Require host firewall",
    help: "The operating system firewall must be enabled on all profiles.",
    rules: ["FIREWALL_DISABLED"],
  },
  requireDiskEncryption: {
    key: "requireDiskEncryption",
    label: "Require full-disk encryption",
    help: "BitLocker, FileVault or LUKS must protect the system volume.",
    rules: ["DISK_ENCRYPTION_DISABLED"],
  },
  requireSecureBoot: {
    key: "requireSecureBoot",
    label: "Require Secure Boot",
    help: "UEFI Secure Boot must be enabled to protect against boot-level malware.",
    rules: ["SECURE_BOOT_DISABLED"],
  },
  autoUpdateEnabled: {
    key: "autoUpdateEnabled",
    label: "Require OS automatic updates",
    help: "Operating system automatic updates must stay enabled on the device.",
    rules: ["AUTO_UPDATE_DISABLED"],
  },
  autoPatchDeployment: {
    key: "autoPatchDeployment",
    label: "Automatic patch deployment",
    help: "Missing patches are installed automatically by the agent within the maintenance window.",
  },
  screenLockEnabled: {
    key: "screenLockEnabled",
    label: "Enforce screen lock",
    help: "The device must lock after the inactivity timeout below.",
    rules: ["SCREEN_LOCK_DISABLED"],
  },
  requirePasswordOnWake: {
    key: "requirePasswordOnWake",
    label: "Require password on wake",
    help: "Users must re-authenticate when the device wakes from sleep or the screen saver.",
    rules: ["SCREEN_LOCK_DISABLED"],
  },
  screenSaverEnforced: {
    key: "screenSaverEnforced",
    label: "Enforce screen saver",
    help: "A screen saver is enforced and cannot be disabled by the user.",
  },
};

export const CHECKIN_OPTIONS = [60, 120, 300, 600, 900, 1800, 3600];
export const INVENTORY_OPTIONS = [900, 1800, 3600, 7200, 14400, 21600, 43200, 86400];

export function formatInterval(sec: number): string {
  if (sec < 60) return `${sec} seconds`;
  if (sec < 3600) return `${Math.round(sec / 60)} minute${sec === 60 ? "" : "s"}`;
  const h = sec / 3600;
  if (h < 24) return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;
  const d = h / 24;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
}
