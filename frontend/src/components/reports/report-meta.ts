import {
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  Laptop,
  Package,
  ScrollText,
  ShieldCheck,
  Table2,
  Usb,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReportFormat, ReportType } from "@/types/api";

export const REPORT_TYPE_META: Record<ReportType, { label: string; description: string; icon: LucideIcon }> = {
  COMPLIANCE: { label: "Compliance", description: "Per-device compliance state, score, risk and failing rules.", icon: ClipboardCheck },
  DEVICE: { label: "Device inventory", description: "Hardware, OS, assignment and warranty for every endpoint.", icon: Laptop },
  SOFTWARE: { label: "Software", description: "Installed applications, unauthorized and blacklisted titles.", icon: Package },
  SECURITY: { label: "Security posture", description: "Antivirus, EDR, firewall, encryption and secure boot status.", icon: ShieldCheck },
  AUDIT: { label: "Audit trail", description: "Administrative actions and changes over the selected period.", icon: ScrollText },
  USB: { label: "USB activity", description: "Blocked and allowed USB connections and file transfers.", icon: Usb },
  PATCH: { label: "Patch status", description: "Missing, failed and installed patches with CVE references.", icon: Wrench },
};

export const REPORT_FORMAT_META: Record<ReportFormat, { label: string; short: string; ext: string; icon: LucideIcon }> = {
  PDF: { label: "PDF", short: "PDF", ext: ".pdf", icon: FileText },
  XLSX: { label: "Excel (XLSX)", short: "XLSX", ext: ".xlsx", icon: FileSpreadsheet },
  CSV: { label: "CSV", short: "CSV", ext: ".csv", icon: Table2 },
};

/** Report types for which a complianceState parameter makes sense. */
export const COMPLIANCE_FILTERABLE: ReportType[] = ["COMPLIANCE", "DEVICE"];

export const CRON_PRESETS: { id: string; label: string; cron: string; description: string }[] = [
  { id: "daily", label: "Daily", cron: "0 7 * * *", description: "Every day at 07:00" },
  { id: "weekly", label: "Weekly", cron: "0 7 * * 1", description: "Every Monday at 07:00" },
  { id: "monthly", label: "Monthly", cron: "0 7 1 * *", description: "On the 1st of every month at 07:00" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Best-effort human description of a 5-field cron expression (server time). */
export function describeCron(cron: string): string {
  const preset = CRON_PRESETS.find((p) => p.cron === cron.trim());
  if (preset) return preset.description;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Custom schedule";
  const [min, hour, dom, mon, dow] = parts;
  const isNum = (v: string) => /^\d+$/.test(v);
  if (!isNum(min) || !isNum(hour)) {
    if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every minute";
    if (isNum(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every hour at minute ${min}`;
    return "Custom schedule";
  }
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${time}`;
  if (dom === "*" && mon === "*" && isNum(dow)) return `Every ${WEEKDAYS[Number(dow) % 7]} at ${time}`;
  if (dom === "*" && mon === "*" && (dow === "1-5" || dow === "MON-FRI")) return `Every weekday at ${time}`;
  if (isNum(dom) && mon === "*" && dow === "*") return `On the ${ordinal(Number(dom))} of every month at ${time}`;
  return "Custom schedule";
}

/** Light validation: 5 whitespace-separated fields made of cron characters. */
export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[\d*/,\-A-Za-z?LW#]+$/.test(p));
}
