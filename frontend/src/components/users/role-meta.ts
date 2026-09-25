import type { Tone } from "@/lib/status";
import type { RoleKey, User } from "@/types/api";

export const roleMeta: Record<RoleKey, { label: string; tone: Tone; description: string }> = {
  SUPER_ADMIN: { label: "Super Admin", tone: "critical", description: "Full control, including roles and system settings." },
  SECURITY_ADMIN: { label: "Security Admin", tone: "high", description: "Manages security policies, alerts and system settings." },
  COMPLIANCE_OFFICER: { label: "Compliance Officer", tone: "medium", description: "Owns compliance rules, reports and audit review." },
  IT_ADMIN: { label: "IT Admin", tone: "primary", description: "Operates devices, enrollment, software and user accounts." },
  DEPARTMENT_MANAGER: { label: "Department Manager", tone: "info", description: "Oversees devices and users within their department." },
  EMPLOYEE: { label: "Employee", tone: "neutral", description: "Views own devices and requests USB access." },
  AUDITOR: { label: "Auditor", tone: "low", description: "Read-only access across the console and audit trail." },
  HR_MANAGER: { label: "HR Manager", tone: "success", description: "Attendance, productivity, daily reports and workforce policies." },
};

export type UserStatus = "ACTIVE" | "INACTIVE" | "LOCKED";

export function userStatus(u: Pick<User, "isActive" | "lockedUntil">): UserStatus {
  if (!u.isActive) return "INACTIVE";
  if (u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()) return "LOCKED";
  return "ACTIVE";
}

export const userStatusMeta: Record<UserStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  LOCKED: { label: "Locked", tone: "critical" },
};
