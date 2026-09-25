"use client";

import * as React from "react";
import { Check, Laptop, Loader2, Rocket, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OsIcon } from "@/components/common/os-icon";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDebounce } from "@/hooks/use-debounce";
import { useDeviceSearch } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { patchSeverityMeta, toneDot } from "@/lib/status";
import { cn } from "@/lib/utils";
import { PATCH_SEVERITIES, type OsPlatform, type PatchDeployInput, type PatchSeverity } from "@/types/api";

interface PickedDevice {
  id: string;
  name: string;
  platform: OsPlatform;
}

export function DeployPatchesDialog({
  open,
  onOpenChange,
  initialPatchIds = [],
  onDeployed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPatchIds?: string[];
  onDeployed?: () => void;
}) {
  const [severities, setSeverities] = React.useState<PatchSeverity[]>([]);
  const [patchIds, setPatchIds] = React.useState<string[]>([]);
  const [limitDevices, setLimitDevices] = React.useState(false);
  const [devices, setDevices] = React.useState<PickedDevice[]>([]);
  const [search, setSearch] = React.useState("");
  const debounced = useDebounce(search, 250);
  const lookup = useDeviceSearch(debounced, open && limitDevices);

  // Reset the form each time the dialog opens.
  const initialKey = initialPatchIds.join("|");
  React.useEffect(() => {
    if (!open) return;
    const ids = initialKey ? initialKey.split("|") : [];
    setPatchIds(ids);
    setSeverities(ids.length ? [] : ["CRITICAL"]);
    setLimitDevices(false);
    setDevices([]);
    setSearch("");
  }, [open, initialKey]);

  const mutation = useApiMutation((body: PatchDeployInput) => api.post<{ commands: number }>("/patches/deploy", body), {
    success: (data) => `Queued ${formatNumber(data?.commands ?? 0)} ${data?.commands === 1 ? "command" : "commands"}`,
    invalidate: [["patches"], ["devices"]],
    onSuccess: () => {
      onOpenChange(false);
      onDeployed?.();
    },
  });

  const toggleSeverity = (s: PatchSeverity, on: boolean) =>
    setSeverities((cur) => (on ? [...cur, s].sort((a, b) => PATCH_SEVERITIES.indexOf(a) - PATCH_SEVERITIES.indexOf(b)) : cur.filter((x) => x !== s)));

  const toggleDevice = (d: PickedDevice) =>
    setDevices((cur) => (cur.some((x) => x.id === d.id) ? cur.filter((x) => x.id !== d.id) : [...cur, d]));

  const noSelection = severities.length === 0 && patchIds.length === 0;
  const noDevices = limitDevices && devices.length === 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (noSelection || noDevices) return;
    const body: PatchDeployInput = {};
    if (severities.length) body.severity = severities;
    if (patchIds.length) body.patchIds = patchIds;
    if (limitDevices) body.deviceIds = devices.map((d) => d.id);
    mutation.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-4 text-primary" /> Deploy patches
          </DialogTitle>
          <DialogDescription>
            Queues an install command on each targeted device. Agents install the missing updates at their next check-in, honoring the
            policy maintenance window.
          </DialogDescription>
        </DialogHeader>

        <form id="deploy-patches-form" onSubmit={submit} className="grid min-w-0 gap-5">
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Severity</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PATCH_SEVERITIES.map((s) => {
                const id = `deploy-sev-${s}`;
                const checked = severities.includes(s);
                return (
                  <label
                    key={s}
                    htmlFor={id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors hover:bg-accent/40",
                      checked && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <Checkbox id={id} checked={checked} onCheckedChange={(v) => toggleSeverity(s, v === true)} />
                    <span className={cn("size-2 shrink-0 rounded-full", toneDot[patchSeverityMeta[s].tone])} aria-hidden />
                    {patchSeverityMeta[s].label}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">All missing patches of the checked severities will be installed.</p>
          </fieldset>

          {patchIds.length > 0 && (
            <div className="grid gap-2">
              <Label>Selected patches ({patchIds.length})</Label>
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin">
                {patchIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 font-mono text-xs">
                    {id}
                    <button
                      type="button"
                      className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setPatchIds((cur) => cur.filter((x) => x !== id))}
                      aria-label={`Remove ${id}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="deploy-limit">Limit to specific devices</Label>
                <p className="text-xs text-muted-foreground">
                  {limitDevices ? "Only the devices picked below are targeted." : "All devices missing the selected patches are targeted."}
                </p>
              </div>
              <Switch id="deploy-limit" checked={limitDevices} onCheckedChange={setLimitDevices} />
            </div>

            {limitDevices && (
              <div className="grid gap-2">
                {devices.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {devices.map((d) => (
                      <span key={d.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-primary/5 py-0.5 pl-2 pr-0.5 text-xs">
                        <OsIcon platform={d.platform} className="size-3" />
                        <span className="truncate">{d.name}</span>
                        <button
                          type="button"
                          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={() => toggleDevice(d)}
                          aria-label={`Remove ${d.name}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="deploy-device-search"
                    aria-label="Search devices"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by device name, hostname or serial…"
                    className="h-8 pl-8 text-sm"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto rounded-md border scrollbar-thin">
                  {lookup.isLoading ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Searching…
                    </div>
                  ) : lookup.isError ? (
                    <div className="px-3 py-3 text-xs text-destructive">Could not load devices.</div>
                  ) : (lookup.data ?? []).length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                      <Laptop className="size-3.5" /> No devices found
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {(lookup.data ?? []).map((d) => {
                        const picked = devices.some((x) => x.id === d.id);
                        return (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => toggleDevice({ id: d.id, name: d.deviceName, platform: d.platform })}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/50",
                                picked && "bg-primary/5",
                              )}
                              aria-pressed={picked}
                            >
                              <OsIcon platform={d.platform} className="size-3.5" />
                              <span className="min-w-0 flex-1 truncate">{d.deviceName}</span>
                              <span className="hidden truncate text-xs text-muted-foreground sm:inline">{d.assignedUser?.displayName ?? ""}</span>
                              {picked && <Check className="size-3.5 shrink-0 text-primary" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {noSelection && <p className="text-xs text-destructive">Select at least one severity or patch to deploy.</p>}
          {!noSelection && noDevices && <p className="text-xs text-destructive">Pick at least one device, or turn off the device limit.</p>}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="deploy-patches-form" loading={mutation.isPending} disabled={noSelection || noDevices}>
            <Rocket /> Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
