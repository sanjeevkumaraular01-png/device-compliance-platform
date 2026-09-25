"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Wrench, XCircle } from "lucide-react";
import type { ComplianceFinding, ComplianceResult } from "@/types/api";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComplianceBadge, RiskBadge, SeverityBadge } from "@/components/common/status-badges";
import { ScoreRing } from "@/components/common/score-ring";
import { KeyValueGrid } from "@/components/common/misc";
import { RISK_ORDER, riskMeta, toneColor } from "@/lib/status";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

export function resultDeviceName(r: ComplianceResult) {
  return r.device?.deviceName ?? r.deviceId;
}

function sortFindings(f: ComplianceFinding[]) {
  return [...f].sort(
    (a, b) => Number(a.passed) - Number(b.passed) || RISK_ORDER.indexOf(a.severity) - RISK_ORDER.indexOf(b.severity) || b.weight - a.weight,
  );
}

function FindingItem({ f }: { f: ComplianceFinding }) {
  const tone = riskMeta[f.severity]?.tone ?? "unknown";
  return (
    <li className={cn("rounded-md border p-3", !f.passed && "border-l-[3px]", f.passed && "bg-muted/30")} style={!f.passed ? { borderLeftColor: toneColor[tone] } : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {f.passed ? <CheckCircle2 className="size-4 shrink-0 text-sev-none" /> : <XCircle className="size-4 shrink-0 text-sev-critical" />}
        <span className="min-w-0 flex-1 text-sm font-medium">{f.name}</span>
        {!f.passed && <SeverityBadge value={f.severity} />}
        {!f.passed && f.weight > 0 && (
          <Badge tone="neutral" className="tabular">
            −{f.weight}
          </Badge>
        )}
        {!f.passed && f.markNonCompliant && <Badge tone="critical">Non-compliant</Badge>}
      </div>
      <p className="mt-0.5 pl-6 font-mono text-[11px] text-muted-foreground">{f.ruleKey}</p>
      {f.detail && <p className="mt-1.5 pl-6 text-xs">{f.detail}</p>}
      {!f.passed && f.remediation && (
        <p className="mt-2 ml-6 flex gap-1.5 rounded bg-muted px-2 py-1.5 text-xs">
          <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>
            <span className="font-medium">Remediation: </span>
            {f.remediation}
          </span>
        </p>
      )}
    </li>
  );
}

export function FindingsSheet({ result, open, onOpenChange }: { result: ComplianceResult | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { can } = useAuth();
  const findings = React.useMemo(() => sortFindings(result?.findings ?? []), [result]);
  const failed = findings.filter((f) => !f.passed);
  const passed = findings.filter((f) => f.passed);

  return (
    <Sheet open={open && !!result} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0">
        {result && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <ScoreRing score={result.score} size={44} stroke={4} />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{resultDeviceName(result)}</SheetTitle>
                  <SheetDescription>Evaluated {formatDateTime(result.evaluatedAt)}</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SheetBody className="grid content-start gap-4 pt-4">
              <KeyValueGrid
                cols={2}
                items={[
                  { label: "State", value: <ComplianceBadge value={result.state} /> },
                  { label: "Risk", value: <RiskBadge value={result.riskLevel} /> },
                  { label: "Policy version", value: result.policyVersion ? `v${result.policyVersion}` : null, mono: true },
                  { label: "Failed / total rules", value: `${failed.length} / ${findings.length}` },
                ]}
              />
              {can("devices:read") && (
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <Link href={`/devices/${result.deviceId}?tab=compliance`}>
                    <ExternalLink /> Open device
                  </Link>
                </Button>
              )}

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">
                  Failed checks <span className="font-normal text-muted-foreground">({failed.length})</span>
                </h3>
                {failed.length === 0 ? (
                  <p className="flex items-center gap-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-4 text-sev-none" /> All evaluated rules passed.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {failed.map((f) => (
                      <FindingItem key={f.ruleKey} f={f} />
                    ))}
                  </ul>
                )}
              </section>

              {passed.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">
                    Passed checks <span className="font-normal text-muted-foreground">({passed.length})</span>
                  </h3>
                  <ul className="grid gap-2">
                    {passed.map((f) => (
                      <FindingItem key={f.ruleKey} f={f} />
                    ))}
                  </ul>
                </section>
              )}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
