"use client";

import * as React from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import type { WorkforcePolicy } from "@/types/api";

export function AssignDepartmentsDialog({
  policy,
  onOpenChange,
}: {
  policy: WorkforcePolicy | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!policy} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Assign departments
          </DialogTitle>
          <DialogDescription>
            Employees in the selected departments use <span className="font-medium text-foreground">{policy?.name}</span>. A department can have only one
            workforce policy — selecting it here moves it from its current policy.
          </DialogDescription>
        </DialogHeader>
        {policy && <AssignForm key={policy.id} policy={policy} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({ policy, onDone }: { policy: WorkforcePolicy; onDone: () => void }) {
  const deps = useDepartments();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set((policy.departments ?? []).map((d) => d.id)));
  const [filter, setFilter] = React.useState("");

  const assign = useApiMutation((departmentIds: string[]) => api.post(`/workforce/policies/${policy.id}/assign`, { departmentIds }), {
    success: (_r, ids) => `${ids.length} department${ids.length === 1 ? "" : "s"} assigned to ${policy.name}`,
    invalidate: [["workforce", "policies"], ["departments"]],
    onSuccess: onDone,
  });

  const list = (deps.data ?? []).filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="grid grid-cols-1 gap-3">
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter departments…" aria-label="Filter departments" className="h-8 text-xs" />
      <div className="max-h-72 overflow-y-auto rounded-md border scrollbar-thin">
        {deps.isLoading ? (
          <div className="grid grid-cols-1 gap-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : deps.isError ? (
          <ErrorState compact error={deps.error} onRetry={() => deps.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState compact icon={Building2} title="No departments" description={filter ? "No department matches the filter." : "Create departments first."} />
        ) : (
          <ul className="divide-y">
            {list.map((d) => {
              const id = `assign-${d.id}`;
              return (
                <li key={d.id}>
                  <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50">
                    <Checkbox id={id} checked={selected.has(d.id)} onCheckedChange={(v) => toggle(d.id, !!v)} />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {d.code && <span className="font-mono text-[11px] text-muted-foreground">{d.code}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{selected.size} selected</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" disabled={selected.size === 0} loading={assign.isPending} onClick={() => assign.mutate([...selected])}>
          Assign
        </Button>
      </DialogFooter>
    </div>
  );
}
