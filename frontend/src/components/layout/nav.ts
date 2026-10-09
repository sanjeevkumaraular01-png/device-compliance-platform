import {
  Activity,
  BarChart3,
  Bot,
  CalendarCheck,
  Camera,
  ClipboardList,
  ListTodo,
  SlidersHorizontal,
  Sun,
  UsersRound,
  AlertTriangle,
  Boxes,
  Briefcase,
  Building2,
  ClipboardCheck,
  FileBarChart,
  KeyRound,
  LayoutDashboard,
  Laptop,
  Package,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  ShieldHalf,
  Usb,
  Users,
  IdCard,
  Wrench,
} from "lucide-react";
import type { RoleKey } from "@/types/api";

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Visible when the user has ANY of these permissions. Empty = any authenticated user. */
  permissions: string[];
  hideForRoles?: RoleKey[];
  /** Label override per role (e.g. "My Devices" for employees). */
  roleLabels?: Partial<Record<RoleKey, string>>;
  keywords?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permissions: ["dashboard:read"], keywords: ["home", "kpi"] }],
  },
  {
    label: "Endpoints",
    items: [
      {
        title: "Devices",
        href: "/devices",
        icon: Laptop,
        permissions: ["devices:read"],
        roleLabels: { EMPLOYEE: "My Devices" },
        keywords: ["endpoints", "inventory", "assets"],
      },
      { title: "Enrollment", href: "/enrollment", icon: PlugZap, permissions: ["enrollment:manage"], keywords: ["tokens", "install", "agent"] },
      { title: "Policies", href: "/policies", icon: ShieldHalf, permissions: ["policies:read"], keywords: ["configuration", "baseline"] },
      {
        title: "Work Profiles",
        href: "/work-profiles",
        icon: Briefcase,
        permissions: ["policies:read"],
        keywords: ["role template", "sales", "finance", "hr", "developer", "management", "support", "employee automation"],
      },
      {
        title: "Device Groups",
        href: "/device-groups",
        icon: Boxes,
        permissions: ["devices:read"],
        keywords: ["groups", "collections", "organize", "fleet", "tags"],
      },
    ],
  },
  {
    label: "Protection",
    items: [
      { title: "Compliance", href: "/compliance", icon: ClipboardCheck, permissions: ["compliance:read"], hideForRoles: ["EMPLOYEE"], keywords: ["rules", "score"] },
      { title: "Security", href: "/security", icon: ShieldCheck, permissions: ["security:read"], keywords: ["antivirus", "edr", "firewall", "encryption", "bitlocker"] },
      { title: "Patches", href: "/patches", icon: Wrench, permissions: ["patches:read"], keywords: ["updates", "cve", "vulnerabilities"] },
      {
        title: "USB Control",
        href: "/usb",
        icon: Usb,
        permissions: ["usb:read", "usb:request"],
        roleLabels: { EMPLOYEE: "USB Access" },
        keywords: ["removable", "storage", "whitelist"],
      },
      { title: "Software", href: "/software", icon: Package, permissions: ["software:read"], keywords: ["applications", "licenses", "blacklist"] },
    ],
  },
  {
    label: "Workforce",
    items: [
      {
        title: "Live Dashboard",
        href: "/workforce",
        icon: UsersRound,
        permissions: ["workforce:read"],
        keywords: ["workforce", "employees", "online", "productivity", "attendance", "live", "team"],
      },
      { title: "My Day", href: "/workforce/me", icon: Sun, permissions: ["workforce:self"], keywords: ["clock in", "clock out", "break", "timeline", "my activity"] },
      {
        title: "Attendance",
        href: "/workforce/attendance",
        icon: CalendarCheck,
        permissions: ["workforce:read"],
        keywords: ["late", "absent", "leave", "monthly sheet", "timesheet", "hrms", "export"],
      },
      {
        title: "Tasks & Projects",
        href: "/workforce/tasks",
        icon: ListTodo,
        permissions: ["workforce:self", "tasks:manage", "workforce:read"],
        roleLabels: { EMPLOYEE: "My Tasks" },
        keywords: ["timer", "time tracking", "projects", "import", "crm", "tickets"],
      },
      {
        title: "Daily Reports",
        href: "/workforce/reports",
        icon: ClipboardList,
        permissions: ["workforce:self", "workforce:read"],
        keywords: ["eod", "end of day", "work report", "status update", "review"],
      },
      { title: "Analytics", href: "/workforce/analytics", icon: BarChart3, permissions: ["workforce:read"], keywords: ["productivity", "focus", "overtime", "utilization", "trend"] },
      { title: "Screenshots", href: "/workforce/screenshots", icon: Camera, permissions: ["workforce:screenshots"], keywords: ["capture", "monitoring"] },
      { title: "AI Insights", href: "/workforce/ai", icon: Bot, permissions: ["workforce:ai"], keywords: ["claude", "summary", "intelligence", "management"] },
      {
        title: "Workforce Settings",
        href: "/workforce/settings",
        icon: SlidersHorizontal,
        permissions: ["workforce:manage"],
        keywords: ["policies", "categories", "apps", "websites", "idle", "hrms", "schedule", "office network"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Alerts", href: "/alerts", icon: AlertTriangle, permissions: ["alerts:read"], keywords: ["notifications", "channels", "incidents"] },
      { title: "Reports", href: "/reports", icon: FileBarChart, permissions: ["reports:read"], keywords: ["export", "pdf", "excel"] },
      { title: "Audit Logs", href: "/audit", icon: ScrollText, permissions: ["audit:read"], keywords: ["history", "trail", "login"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Employees (HR)", href: "/hr", icon: IdCard, permissions: ["users:read"], hideForRoles: ["EMPLOYEE"], keywords: ["hr", "directory", "onboarding", "offboarding", "leaver", "notice", "consent", "acknowledgement"] },
      { title: "Users", href: "/users", icon: Users, permissions: ["users:read"], keywords: ["accounts", "people"] },
      { title: "Departments", href: "/departments", icon: Building2, permissions: ["users:read"], keywords: ["teams", "org"] },
      { title: "Roles", href: "/roles", icon: KeyRound, permissions: ["users:read", "roles:write"], keywords: ["permissions", "rbac"] },
      { title: "Settings", href: "/settings", icon: Settings, permissions: [], keywords: ["profile", "mfa", "sessions", "ip"] },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** Finds the nav entry that owns a pathname (longest prefix match). */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}

export function navLabel(item: NavItem, role: RoleKey | undefined): string {
  return (role && item.roleLabels?.[role]) || item.title;
}

export function isNavVisible(item: NavItem, can: (p: string[]) => boolean, role: RoleKey | undefined): boolean {
  if (role && item.hideForRoles?.includes(role)) return false;
  return item.permissions.length === 0 || can(item.permissions);
}

export const ACTIVITY_ICON = Activity;
