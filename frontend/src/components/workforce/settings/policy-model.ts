import type { WorkforcePolicy, WorkforcePolicyInput } from "@/types/api";

/** Defaults mirror `WorkforcePolicy` in backend/prisma/schema.prisma. */
export const POLICY_DEFAULTS: WorkforcePolicyInput = {
  name: "",
  description: null,
  isDefault: false,
  trackingEnabled: true,
  timezone: "Asia/Kolkata",
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:30",
  workEnd: "18:30",
  graceMinutes: 15,
  minDailyMinutes: 480,
  halfDayMinutes: 240,
  overtimeAfterMinutes: 540,
  maxBreakMinutes: 60,
  trackOutsideWorkHours: false,
  idleThresholdSec: 300,
  trackApps: true,
  trackWebsites: true,
  captureWindowTitles: false,
  screenshotsEnabled: false,
  screenshotIntervalMin: 15,
  screenshotBlur: true,
  screenshotRetentionDays: 30,
  officeNetworks: [],
  requireTaskSelection: false,
  requireDailyReport: true,
  dailyReportDueTime: "19:30",
  alertLateLogin: true,
  alertNoActivityMinutes: 30,
  alertIdlePercent: 40,
  alertOvertimeMinutes: 120,
  alertUnproductivePercent: 30,
  employeeCanSeeOwnData: true,
  showTrackingNotice: true,
};

/** Integer fields edited as text, with the backend DTO bounds. */
export const INT_FIELDS = {
  graceMinutes: { min: 0, max: 240 },
  minDailyMinutes: { min: 0, max: 1440 },
  halfDayMinutes: { min: 0, max: 1440 },
  overtimeAfterMinutes: { min: 0, max: 1440 },
  maxBreakMinutes: { min: 0, max: 600 },
  screenshotRetentionDays: { min: 1, max: 365 },
  alertNoActivityMinutes: { min: 0, max: 1440 },
  alertIdlePercent: { min: 0, max: 100 },
  alertOvertimeMinutes: { min: 0, max: 1440 },
  alertUnproductivePercent: { min: 0, max: 100 },
} as const;
export type IntKey = keyof typeof INT_FIELDS;

export type PolicyDraft = Omit<WorkforcePolicyInput, IntKey | "description"> & Record<IntKey, string> & { description: string };

export function toDraft(p: WorkforcePolicy | null): PolicyDraft {
  const src: WorkforcePolicyInput = { ...POLICY_DEFAULTS };
  if (p) {
    for (const k of Object.keys(POLICY_DEFAULTS) as (keyof WorkforcePolicyInput)[]) {
      const v = p[k];
      if (v !== undefined && v !== null) (src as unknown as Record<string, unknown>)[k] = v;
    }
    src.description = p.description ?? null;
  }
  const draft = { ...src, description: src.description ?? "" } as unknown as PolicyDraft;
  for (const k of Object.keys(INT_FIELDS) as IntKey[]) draft[k] = String(src[k] ?? "");
  draft.workDays = [...(src.workDays ?? [])].sort((a, b) => a - b);
  draft.officeNetworks = [...(src.officeNetworks ?? [])];
  return draft;
}

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateDraft(d: PolicyDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const name = d.name.trim();
  if (!name) e.name = "Name is required";
  else if (name.length > 120) e.name = "Max 120 characters";
  if (d.description.length > 500) e.description = "Max 500 characters";
  if (d.workDays.length === 0) e.workDays = "Select at least one workday";
  for (const k of ["workStart", "workEnd", "dailyReportDueTime"] as const) {
    if (!HM_RE.test(d[k])) e[k] = "Use HH:mm";
  }
  if (!e.workStart && !e.workEnd && d.workStart === d.workEnd) e.workEnd = "End must differ from start";
  for (const [k, b] of Object.entries(INT_FIELDS) as [IntKey, { min: number; max: number }][]) {
    const s = d[k].trim();
    const n = Number(s);
    if (s === "" || !Number.isInteger(n)) e[k] = "Whole number required";
    else if (n < b.min || n > b.max) e[k] = `${b.min}–${b.max}`;
  }
  if (!e.halfDayMinutes && !e.minDailyMinutes && Number(d.halfDayMinutes) > Number(d.minDailyMinutes)) {
    e.halfDayMinutes = "Must not exceed the minimum daily minutes";
  }
  const badNet = d.officeNetworks.find((n) => networkError(n));
  if (badNet) e.officeNetworks = `Invalid entry: ${badNet}`;
  return e;
}

export function toBody(d: PolicyDraft): WorkforcePolicyInput {
  const body = { ...d, name: d.name.trim(), description: d.description.trim() || null } as unknown as WorkforcePolicyInput;
  for (const k of Object.keys(INT_FIELDS) as IntKey[]) (body as unknown as Record<string, number>)[k] = Number(d[k]);
  body.workDays = [...d.workDays].sort((a, b) => a - b);
  body.officeNetworks = d.officeNetworks.map((n) => n.trim()).filter(Boolean);
  return body;
}

// ─────────────────────────────── Networks ───────────────────────────────

function ipv4Ok(ip: string): boolean {
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function ipv6Ok(ip: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(ip) || !ip.includes(":")) return false;
  const doubles = ip.split("::").length - 1;
  if (doubles > 1) return false;
  let groups = ip.split(":").filter((g) => g !== "");
  // Embedded IPv4 tail (e.g. ::ffff:10.0.0.1)
  const last = groups[groups.length - 1];
  if (last && last.includes(".")) {
    if (!ipv4Ok(last)) return false;
    groups = [...groups.slice(0, -1), "0", "0"];
  }
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return doubles === 1 ? groups.length < 8 : groups.length === 8;
}

/** Returns an error message, or null when the entry is a valid IPv4/IPv6 address/CIDR or `ssid:<name>`. */
export function networkError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Empty entry";
  if (/^ssid:/i.test(v)) {
    const name = v.slice(5);
    return name.trim().length >= 1 && name.length <= 64 ? null : "SSID name must be 1–64 characters";
  }
  if (v.length > 120) return "Too long";
  const [ip, prefix, extra] = v.split("/");
  if (extra !== undefined) return "Invalid CIDR";
  if (ipv4Ok(ip)) {
    if (prefix === undefined) return null;
    return /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32 ? null : "IPv4 prefix must be 0–32";
  }
  if (ipv6Ok(ip)) {
    if (prefix === undefined) return null;
    return /^\d{1,3}$/.test(prefix) && Number(prefix) <= 128 ? null : "IPv6 prefix must be 0–128";
  }
  return "Use a CIDR (10.0.0.0/8), an IP address, or ssid:<name>";
}

// ─────────────────────────────── Display helpers ───────────────────────────────

export const WEEKDAYS: { iso: number; short: string; long: string }[] = [
  { iso: 1, short: "Mon", long: "Monday" },
  { iso: 2, short: "Tue", long: "Tuesday" },
  { iso: 3, short: "Wed", long: "Wednesday" },
  { iso: 4, short: "Thu", long: "Thursday" },
  { iso: 5, short: "Fri", long: "Friday" },
  { iso: 6, short: "Sat", long: "Saturday" },
  { iso: 7, short: "Sun", long: "Sunday" },
];

export function workdaysLabel(days: number[] | undefined): string {
  const set = [...new Set(days ?? [])].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (set.length === 0) return "No workdays";
  if (set.length === 7) return "Every day";
  const contiguous = set.every((d, i) => i === 0 || d === set[i - 1] + 1);
  const name = (d: number) => WEEKDAYS[d - 1].short;
  if (contiguous && set.length > 2) return `${name(set[0])}–${name(set[set.length - 1])}`;
  return set.map(name).join(", ");
}

export function scheduleSummary(p: Pick<WorkforcePolicy, "workDays" | "workStart" | "workEnd" | "timezone">): string {
  return `${workdaysLabel(p.workDays)} · ${p.workStart}–${p.workEnd}`;
}

const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
];

let tzCache: string[] | null = null;
export function timezones(): string[] {
  if (tzCache) return tzCache;
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = fn ? fn("timeZone") : [];
    tzCache = list.length > 0 ? (list.includes("UTC") ? list : ["UTC", ...list]) : FALLBACK_TIMEZONES;
  } catch {
    tzCache = FALLBACK_TIMEZONES;
  }
  return tzCache;
}
