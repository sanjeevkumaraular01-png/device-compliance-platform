import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, Info, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  alertSeverityMeta,
  complianceMeta,
  riskMeta,
  toneDot,
  type StatusMeta,
  type Tone,
} from "@/lib/status";
import type { AlertSeverity, ComplianceState, RiskLevel } from "@/types/api";
import { humanize } from "@/lib/format";

/** Generic badge driven by one of the meta maps in lib/status.ts */
export function StatusBadge<K extends string>({
  value,
  meta,
  className,
  dot = true,
}: {
  value: K | null | undefined;
  meta: Record<K, StatusMeta>;
  className?: string;
  dot?: boolean;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const m = meta[value] ?? { label: humanize(value), tone: "unknown" as Tone };
  return (
    <Badge tone={m.tone} dot={dot} className={className}>
      {m.label}
    </Badge>
  );
}

const riskIcon: Record<RiskLevel, React.ComponentType<{ className?: string }>> = {
  CRITICAL: AlertOctagon,
  HIGH: ShieldAlert,
  MEDIUM: AlertTriangle,
  LOW: Info,
  NONE: CheckCircle2,
};

export function RiskBadge({ value, className }: { value: RiskLevel | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const m = riskMeta[value];
  const Icon = riskIcon[value] ?? CircleHelp;
  return (
    <Badge tone={m.tone} className={className}>
      <Icon />
      {m.label}
    </Badge>
  );
}

export function SeverityBadge({ value, className }: { value: AlertSeverity | RiskLevel | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const m = (alertSeverityMeta as Record<string, StatusMeta>)[value] ?? (riskMeta as Record<string, StatusMeta>)[value];
  return (
    <Badge tone={m?.tone ?? "unknown"} dot className={className}>
      {m?.label ?? humanize(value)}
    </Badge>
  );
}

export function ComplianceBadge({ value, className }: { value: ComplianceState | null | undefined; className?: string }) {
  return <StatusBadge value={value} meta={complianceMeta} className={className} />;
}

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", toneDot[tone], className)} aria-hidden />;
}

export function BoolBadge({
  value,
  trueLabel = "Yes",
  falseLabel = "No",
  invert = false,
}: {
  value: boolean | null | undefined;
  trueLabel?: string;
  falseLabel?: string;
  invert?: boolean;
}) {
  if (value === null || value === undefined) return <Badge tone="unknown">Unknown</Badge>;
  const good = invert ? !value : value;
  return (
    <Badge tone={good ? "success" : "critical"} dot>
      {value ? trueLabel : falseLabel}
    </Badge>
  );
}
