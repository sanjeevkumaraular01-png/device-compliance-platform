// Central status / severity color system.
// CRITICAL red · HIGH orange · MEDIUM amber · LOW blue · NONE/COMPLIANT green · UNKNOWN gray.

import type {
  ActivityCategory,
  AiInsightStatus,
  AttendanceStatus,
  DailyReportStatus,
  LiveStatus,
  ProjectStatus,
  ReportConsistencyStatus,
  TaskPriority,
  TaskStatus,
  WorkLocation,
  WorkloadLevel,
  AlertSeverity,
  AlertStatus,
  CommandStatus,
  ComplianceState,
  DeliveryStatus,
  DeviceStatus,
  PatchSeverity,
  PatchState,
  ProtectionState,
  ReportStatus,
  RiskLevel,
  SoftwareStatus,
  UsbAccessStatus,
  UsbEventType,
  WarrantyStatus,
} from "@/types/api";

export type Tone = "critical" | "high" | "medium" | "low" | "success" | "unknown" | "info" | "neutral" | "primary";

/** Badge classes per tone (soft background + strong foreground + subtle ring). */
export const toneBadge: Record<Tone, string> = {
  critical: "bg-sev-critical/12 text-sev-critical ring-sev-critical/25",
  high: "bg-sev-high/12 text-sev-high ring-sev-high/25",
  medium: "bg-sev-medium/14 text-sev-medium ring-sev-medium/30",
  low: "bg-sev-low/12 text-sev-low ring-sev-low/25",
  success: "bg-sev-none/12 text-sev-none ring-sev-none/25",
  unknown: "bg-sev-unknown/12 text-sev-unknown ring-sev-unknown/25",
  info: "bg-info/12 text-info ring-info/25",
  neutral: "bg-muted text-muted-foreground ring-border",
  primary: "bg-primary/12 text-primary ring-primary/25",
};

/** Solid dot / bar classes per tone. */
export const toneDot: Record<Tone, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
  success: "bg-sev-none",
  unknown: "bg-sev-unknown",
  info: "bg-info",
  neutral: "bg-muted-foreground",
  primary: "bg-primary",
};

export const toneText: Record<Tone, string> = {
  critical: "text-sev-critical",
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-sev-low",
  success: "text-sev-none",
  unknown: "text-sev-unknown",
  info: "text-info",
  neutral: "text-muted-foreground",
  primary: "text-primary",
};

/** CSS color values (for charts/SVG). Resolve at paint time so they follow the theme. */
export const toneColor: Record<Tone, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
  success: "var(--sev-none)",
  unknown: "var(--sev-unknown)",
  info: "var(--info)",
  neutral: "var(--muted-foreground)",
  primary: "var(--primary)",
};

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const riskMeta: Record<RiskLevel, StatusMeta> = {
  CRITICAL: { label: "Critical", tone: "critical" },
  HIGH: { label: "High", tone: "high" },
  MEDIUM: { label: "Medium", tone: "medium" },
  LOW: { label: "Low", tone: "low" },
  NONE: { label: "None", tone: "success" },
};

export const alertSeverityMeta: Record<AlertSeverity, StatusMeta> = {
  CRITICAL: { label: "Critical", tone: "critical" },
  HIGH: { label: "High", tone: "high" },
  MEDIUM: { label: "Medium", tone: "medium" },
  LOW: { label: "Low", tone: "low" },
  INFO: { label: "Info", tone: "info" },
};

export const patchSeverityMeta: Record<PatchSeverity, StatusMeta> = {
  CRITICAL: { label: "Critical", tone: "critical" },
  IMPORTANT: { label: "Important", tone: "high" },
  MODERATE: { label: "Moderate", tone: "medium" },
  LOW: { label: "Low", tone: "low" },
  UNSPECIFIED: { label: "Unspecified", tone: "unknown" },
};

export const complianceMeta: Record<ComplianceState, StatusMeta> = {
  COMPLIANT: { label: "Compliant", tone: "success" },
  NON_COMPLIANT: { label: "Non-compliant", tone: "critical" },
  UNKNOWN: { label: "Unknown", tone: "unknown" },
};

export const protectionMeta: Record<ProtectionState, StatusMeta> = {
  ENABLED: { label: "Enabled", tone: "success" },
  DISABLED: { label: "Disabled", tone: "critical" },
  NOT_INSTALLED: { label: "Not installed", tone: "high" },
  OUTDATED: { label: "Outdated", tone: "medium" },
  UNKNOWN: { label: "Unknown", tone: "unknown" },
};

export const deviceStatusMeta: Record<DeviceStatus, StatusMeta> = {
  ACTIVE: { label: "Active", tone: "success" },
  PENDING: { label: "Pending", tone: "medium" },
  INACTIVE: { label: "Inactive", tone: "unknown" },
  QUARANTINED: { label: "Quarantined", tone: "critical" },
  RETIRED: { label: "Retired", tone: "neutral" },
};

export const warrantyMeta: Record<WarrantyStatus, StatusMeta> = {
  ACTIVE: { label: "Active", tone: "success" },
  EXPIRING: { label: "Expiring", tone: "medium" },
  EXPIRED: { label: "Expired", tone: "critical" },
  UNKNOWN: { label: "Unknown", tone: "unknown" },
};

export const softwareStatusMeta: Record<SoftwareStatus, StatusMeta> = {
  APPROVED: { label: "Approved", tone: "success" },
  UNAUTHORIZED: { label: "Unauthorized", tone: "high" },
  BLACKLISTED: { label: "Blacklisted", tone: "critical" },
  UNKNOWN: { label: "Unclassified", tone: "unknown" },
};

export const patchStateMeta: Record<PatchState, StatusMeta> = {
  INSTALLED: { label: "Installed", tone: "success" },
  MISSING: { label: "Missing", tone: "high" },
  PENDING_INSTALL: { label: "Pending install", tone: "info" },
  FAILED: { label: "Failed", tone: "critical" },
};

export const alertStatusMeta: Record<AlertStatus, StatusMeta> = {
  OPEN: { label: "Open", tone: "critical" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "medium" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

export const usbEventMeta: Record<UsbEventType, StatusMeta> = {
  BLOCKED: { label: "Blocked", tone: "critical" },
  ALLOWED: { label: "Allowed", tone: "success" },
  CONNECTED: { label: "Connected", tone: "info" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
  FILE_WRITE: { label: "File write", tone: "medium" },
  FILE_READ: { label: "File read", tone: "low" },
};

export const usbAccessMeta: Record<UsbAccessStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "medium" },
  APPROVED: { label: "Approved", tone: "success" },
  DENIED: { label: "Denied", tone: "critical" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REVOKED: { label: "Revoked", tone: "unknown" },
};

export const commandStatusMeta: Record<CommandStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "medium" },
  SENT: { label: "Sent", tone: "info" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "unknown" },
};

export const reportStatusMeta: Record<ReportStatus, StatusMeta> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
};

export const deliveryStatusMeta: Record<DeliveryStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "medium" },
  SENT: { label: "Sent", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
};

/** Score (0-100) → tone. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined || Number.isNaN(score)) return "unknown";
  if (score >= 90) return "success";
  if (score >= 75) return "low";
  if (score >= 60) return "medium";
  if (score >= 40) return "high";
  return "critical";
}

/** Percentage where higher is better → tone. */
export function rateTone(rate: number): Tone {
  if (rate >= 90) return "success";
  if (rate >= 75) return "low";
  if (rate >= 50) return "medium";
  return "critical";
}

export const RISK_ORDER: RiskLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"];

// ─────────────────────────────── Workforce ───────────────────────────────



/** Productivity category: PRODUCTIVE green · NEUTRAL blue · UNPRODUCTIVE amber · BLOCKED red · UNCATEGORIZED gray. */
export const categoryMeta: Record<ActivityCategory, StatusMeta> = {
  PRODUCTIVE: { label: "Productive", tone: "success" },
  NEUTRAL: { label: "Neutral", tone: "low" },
  UNPRODUCTIVE: { label: "Unproductive", tone: "medium" },
  BLOCKED: { label: "Blocked", tone: "critical" },
  UNCATEGORIZED: { label: "Uncategorized", tone: "unknown" },
};

export const liveStatusMeta: Record<LiveStatus, StatusMeta> = {
  ONLINE_ACTIVE: { label: "Active", tone: "success" },
  ONLINE_IDLE: { label: "Idle", tone: "medium" },
  ON_BREAK: { label: "On break", tone: "info" },
  OFFLINE: { label: "Offline", tone: "unknown" },
  CLOCKED_OUT: { label: "Clocked out", tone: "neutral" },
};

export const attendanceMeta: Record<AttendanceStatus, StatusMeta & { short: string }> = {
  PRESENT: { label: "Present", tone: "success", short: "P" },
  LATE: { label: "Late", tone: "medium", short: "L" },
  HALF_DAY: { label: "Half day", tone: "high", short: "HD" },
  ABSENT: { label: "Absent", tone: "critical", short: "A" },
  ON_LEAVE: { label: "On leave", tone: "info", short: "LV" },
  HOLIDAY: { label: "Holiday", tone: "primary", short: "H" },
  WEEKEND: { label: "Weekly off", tone: "neutral", short: "WO" },
};

export const locationMeta: Record<WorkLocation, StatusMeta> = {
  OFFICE: { label: "Office", tone: "primary" },
  REMOTE: { label: "Remote", tone: "info" },
  UNKNOWN: { label: "Unknown", tone: "unknown" },
};

export const taskStatusMeta: Record<TaskStatus, StatusMeta> = {
  TODO: { label: "To do", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  BLOCKED: { label: "Blocked", tone: "critical" },
  IN_REVIEW: { label: "In review", tone: "medium" },
  DONE: { label: "Done", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "unknown" },
};

export const taskPriorityMeta: Record<TaskPriority, StatusMeta> = {
  URGENT: { label: "Urgent", tone: "critical" },
  HIGH: { label: "High", tone: "high" },
  MEDIUM: { label: "Medium", tone: "medium" },
  LOW: { label: "Low", tone: "low" },
};

export const projectStatusMeta: Record<ProjectStatus, StatusMeta> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  ON_HOLD: { label: "On hold", tone: "medium" },
  COMPLETED: { label: "Completed", tone: "primary" },
  CANCELLED: { label: "Cancelled", tone: "unknown" },
};

export const dailyReportStatusMeta: Record<DailyReportStatus | "MISSING", StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "medium" },
  MISSING: { label: "Missing", tone: "critical" },
};

export const aiInsightStatusMeta: Record<AiInsightStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "medium" },
  READY: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
  SKIPPED: { label: "Skipped", tone: "unknown" },
};

export const workloadMeta: Record<WorkloadLevel, StatusMeta> = {
  UNDER_UTILIZED: { label: "Under-utilized", tone: "medium" },
  BALANCED: { label: "Balanced", tone: "success" },
  OVERLOADED: { label: "Overloaded", tone: "critical" },
};

export const reportConsistencyMeta: Record<ReportConsistencyStatus, StatusMeta> = {
  CONSISTENT: { label: "Consistent", tone: "success" },
  PARTIAL: { label: "Partial", tone: "medium" },
  INCONSISTENT: { label: "Inconsistent", tone: "critical" },
  NO_REPORT: { label: "No report", tone: "unknown" },
};

/** Productive % → tone (higher is better). */
export function productiveTone(pctValue: number | null | undefined): Tone {
  if (pctValue === null || pctValue === undefined || Number.isNaN(pctValue)) return "unknown";
  if (pctValue >= 70) return "success";
  if (pctValue >= 50) return "low";
  if (pctValue >= 30) return "medium";
  return "critical";
}

/** Time variance % (actual vs estimate; positive = over estimate) → tone. */
export function varianceTone(v: number | null | undefined): Tone {
  if (v === null || v === undefined || Number.isNaN(v)) return "unknown";
  if (v <= 10) return "success";
  if (v <= 25) return "medium";
  if (v <= 50) return "high";
  return "critical";
}
