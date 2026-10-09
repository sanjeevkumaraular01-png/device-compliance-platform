"use client";

import * as React from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CopyButton } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api, errorMessage } from "@/lib/api";
import type { HrDirectoryRow, OnboardResult } from "@/types/api";

/** Shows an employee's enrollment link + instructions, with an optional "email it" action. */
export function OnboardDialog({ employee, onOpenChange }: { employee: HrDirectoryRow | null; onOpenChange: (open: boolean) => void }) {
  const [result, setResult] = React.useState<OnboardResult | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const prepare = useApiMutation((id: string) => api.post<OnboardResult>(`/hr/employees/${id}/onboard`, { sendEmail: false }), {
    onSuccess: (r) => setResult(r ?? null),
    onError: (e) => setLoadError(errorMessage(e, "Could not prepare the enrollment link")),
  });
  const email = useApiMutation((id: string) => api.post<OnboardResult>(`/hr/employees/${id}/onboard`, { sendEmail: true }), {
    success: (r) => `Enrollment instructions emailed to ${r?.email ?? "the employee"}`,
  });

  const prepareMutate = prepare.mutate;
  React.useEffect(() => {
    setResult(null);
    setLoadError(null);
    if (employee) prepareMutate(employee.id);
  }, [employee, prepareMutate]);

  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4 text-primary" /> Send enrollment link
          </DialogTitle>
          <DialogDescription>
            {employee?.displayName} will sign the monitoring notice and install the agent from this link. IT approves the device afterwards.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{loadError}</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Preparing link…</p>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium">Install link</span>
              <div className="flex items-stretch gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-xs">{result.installUrl}</code>
                <CopyButton value={result.installUrl} label="Copy link" className="self-start" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Message for the employee (WhatsApp / email)</span>
                <CopyButton value={result.instructions} label="Copy message" />
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{result.instructions}</pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => employee && email.mutate(employee.id)} loading={email.isPending} disabled={!result}>
            <Mail /> Email to {employee?.email ?? "employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
