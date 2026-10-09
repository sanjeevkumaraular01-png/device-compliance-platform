"use client";

import { useQuery } from "@tanstack/react-query";
import { Signature } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { HrDirectoryRow, PolicyAcknowledgementRecord } from "@/types/api";

/** Full acknowledgement history for one employee (evidence for audits / DPDP requests). */
export function SignaturesDialog({ employee, onOpenChange }: { employee: HrDirectoryRow | null; onOpenChange: (open: boolean) => void }) {
  const q = useQuery({
    queryKey: ["hr", "acknowledgements", employee?.id],
    queryFn: ({ signal }) => api.get<PolicyAcknowledgementRecord[]>(`/hr/employees/${employee!.id}/acknowledgements`, undefined, { signal }),
    enabled: !!employee,
  });

  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Signature className="size-4 text-primary" /> Notice signatures
          </DialogTitle>
          <DialogDescription>
            {employee?.displayName} · {employee?.employeeCode ?? "no Employee ID"}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">This employee has not signed any version of the monitoring notice yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Version</th>
                  <th className="py-2 pr-3 font-medium">Signed as</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Where</th>
                  <th className="py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id} className="border-b last:border-0" title={a.userAgent ?? undefined}>
                    <td className="py-2 pr-3">v{a.noticeVersion}</td>
                    <td className="py-2 pr-3">{a.signedName}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{formatDateTime(a.acknowledgedAt)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="secondary">{a.method === "INSTALL" ? "Install page" : "Console"}</Badge>
                    </td>
                    <td className="py-2 font-mono text-xs">{a.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
