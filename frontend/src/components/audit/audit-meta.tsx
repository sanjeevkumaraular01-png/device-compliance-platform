import { Bot, Laptop, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { humanize } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { ActorType, AuditCategory, AuthProvider } from "@/types/api";

export const auditCategoryMeta: Record<AuditCategory, { label: string; tone: Tone }> = {
  USER_ACTION: { label: "User action", tone: "primary" },
  DEVICE_CHANGE: { label: "Device change", tone: "info" },
  POLICY_CHANGE: { label: "Policy change", tone: "medium" },
  AUTH: { label: "Authentication", tone: "low" },
  USB: { label: "USB", tone: "high" },
  SOFTWARE: { label: "Software", tone: "neutral" },
  SECURITY: { label: "Security", tone: "critical" },
  SYSTEM: { label: "System", tone: "unknown" },
};

export function AuditCategoryBadge({ value }: { value: AuditCategory }) {
  const m = auditCategoryMeta[value] ?? { label: humanize(value), tone: "unknown" as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

const actorIcon: Record<ActorType, React.ComponentType<{ className?: string }>> = {
  USER: User,
  DEVICE: Laptop,
  SYSTEM: Bot,
};

export function ActorLabel({ type, name, id }: { type: ActorType; name: string | null; id?: string | null }) {
  const Icon = actorIcon[type] ?? User;
  const label = name || (type === "SYSTEM" ? "System" : id ? `${id.slice(0, 8)}…` : "Unknown");
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <SimpleTooltip label={humanize(type)}>
        <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-muted-foreground" aria-label={humanize(type)}>
          <Icon className="size-3" />
        </span>
      </SimpleTooltip>
      <span className="truncate">{label}</span>
    </span>
  );
}

export const authProviderLabel: Record<AuthProvider, string> = {
  LOCAL: "Local",
  LDAP: "LDAP",
  ACTIVE_DIRECTORY: "Active Directory",
  AZURE_AD: "Azure AD",
  OIDC: "OIDC SSO",
};

export function SuccessBadge({ success, failLabel = "Failed" }: { success: boolean; failLabel?: string }) {
  return (
    <Badge tone={success ? "success" : "critical"} dot>
      {success ? "Success" : failLabel}
    </Badge>
  );
}
