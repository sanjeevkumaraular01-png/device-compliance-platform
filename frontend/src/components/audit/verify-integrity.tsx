"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditVerifyResult } from "@/types/api";

/** "Verify integrity" → GET /audit/verify → result dialog. */
export function VerifyIntegrityButton() {
  const [open, setOpen] = React.useState(false);
  const verify = useMutation({ mutationFn: () => api.get<AuditVerifyResult>("/audit/verify") });

  const run = () => {
    setOpen(true);
    verify.mutate();
  };

  const result = verify.data;
  const tone = verify.isPending ? "pending" : verify.isError ? "error" : result ? (result.valid ? "ok" : "broken") : "pending";

  return (
    <>
      <Button variant="outline" size="sm" onClick={run} loading={verify.isPending}>
        {!verify.isPending && <ShieldCheck />} Verify integrity
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Audit chain verification</DialogTitle>
            <DialogDescription>Recomputes every entry&apos;s hash and checks it links to the previous entry.</DialogDescription>
          </DialogHeader>

          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-start gap-3 rounded-md border p-3",
              tone === "ok" && "border-sev-none/30 bg-sev-none/10",
              tone === "broken" && "border-sev-critical/30 bg-sev-critical/10",
              tone === "error" && "border-sev-medium/30 bg-sev-medium/10",
            )}
          >
            {tone === "pending" && (
              <>
                <ShieldQuestion className="mt-0.5 size-5 shrink-0 animate-pulse text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Verifying hash chain…</p>
                  <p className="text-xs text-muted-foreground">This can take a moment for large audit logs.</p>
                </div>
              </>
            )}
            {tone === "ok" && result && (
              <>
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-sev-none" />
                <div>
                  <p className="text-sm font-semibold text-sev-none">Hash chain intact</p>
                  <p className="text-xs text-muted-foreground">{formatNumber(result.checked)} entries verified, hash chain intact. No tampering detected.</p>
                </div>
              </>
            )}
            {tone === "broken" && result && (
              <>
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-sev-critical" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-sev-critical">
                    Chain broken at entry <span className="font-mono">{result.brokenAt ?? "unknown"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(result.checked)} entries checked. The entry or its predecessor was modified or deleted outside the application. Treat
                    this as a security incident and preserve database backups.
                  </p>
                </div>
              </>
            )}
            {tone === "error" && (
              <>
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-sev-medium" />
                <div>
                  <p className="text-sm font-medium">Verification failed to run</p>
                  <p className="text-xs text-muted-foreground">{errorMessage(verify.error)}</p>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
              Run again
            </Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
