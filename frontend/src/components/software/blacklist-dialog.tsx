"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { humanize, platformLabel } from "@/lib/format";
import { RISK_ORDER, riskMeta } from "@/lib/status";
import { matchTypeHelp } from "@/components/software/whitelist-dialog";
import { MATCH_TYPES, OS_PLATFORMS, RISK_LEVELS, type SoftwareBlacklist, type SoftwareBlacklistInput } from "@/types/api";

const schema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    publisher: z.string().trim().max(200),
    matchType: z.enum(MATCH_TYPES),
    platform: z.enum(["ANY", ...OS_PLATFORMS]),
    reason: z.string().trim().min(3, "Explain why this software is prohibited").max(1000),
    severity: z.enum(RISK_LEVELS),
    autoUninstall: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.matchType === "REGEX") {
      try {
        new RegExp(v.name);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Invalid regular expression" });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

function toForm(e?: SoftwareBlacklist | null): FormValues {
  return {
    name: e?.name ?? "",
    publisher: e?.publisher ?? "",
    matchType: e?.matchType ?? "CONTAINS",
    platform: e?.platform ?? "ANY",
    reason: e?.reason ?? "",
    severity: e?.severity ?? "HIGH",
    autoUninstall: e?.autoUninstall ?? false,
  };
}

export function SoftwareBlacklistDialog({ open, onOpenChange, entry }: { open: boolean; onOpenChange: (o: boolean) => void; entry: SoftwareBlacklist | null }) {
  const editing = !!entry;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(entry) });
  const errors = form.formState.errors;
  const matchType = form.watch("matchType");

  React.useEffect(() => {
    if (open) form.reset(toForm(entry));
  }, [open, entry, form]);

  const mutation = useApiMutation(
    (body: SoftwareBlacklistInput) =>
      entry ? api.patch<SoftwareBlacklist>(`/software/blacklist/${entry.id}`, body) : api.post<SoftwareBlacklist>("/software/blacklist", body),
    {
      success: editing ? "Blacklist entry updated" : "Software blacklisted",
      invalidate: [["software"]],
      onSuccess: () => onOpenChange(false),
    },
  );

  const onSubmit = form.handleSubmit((v) =>
    mutation.mutate({
      name: v.name,
      publisher: v.publisher || null,
      matchType: v.matchType,
      platform: v.platform === "ANY" ? null : v.platform,
      reason: v.reason,
      severity: v.severity,
      autoUninstall: v.autoUninstall,
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit blacklisted software" : "Blacklist software"}</DialogTitle>
          <DialogDescription>Matching installations are flagged as Blacklisted and count against device compliance.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="bl-name" error={errors.name?.message} required>
              <Input id="bl-name" placeholder="uTorrent" aria-invalid={!!errors.name || undefined} {...form.register("name")} />
            </Field>
            <Field label="Publisher" htmlFor="bl-publisher" error={errors.publisher?.message}>
              <Input id="bl-publisher" placeholder="Any publisher" {...form.register("publisher")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Match type" htmlFor="bl-match" hint={matchTypeHelp[matchType]}>
              <Controller
                control={form.control}
                name="matchType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="bl-match">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCH_TYPES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {humanize(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Platform" htmlFor="bl-platform">
              <Controller
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="bl-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANY">All platforms</SelectItem>
                      {OS_PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {platformLabel[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Severity" htmlFor="bl-severity">
              <Controller
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="bl-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RISK_ORDER.map((r) => (
                        <SelectItem key={r} value={r}>
                          {riskMeta[r].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <Field label="Reason" htmlFor="bl-reason" error={errors.reason?.message} required>
            <Textarea id="bl-reason" rows={3} placeholder="e.g. Peer-to-peer file sharing — data exfiltration risk" aria-invalid={!!errors.reason || undefined} {...form.register("reason")} />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <div className="text-xs font-medium">Uninstall automatically</div>
              <div className="text-[11px] text-muted-foreground">Queue an uninstall command as soon as an agent reports it (if the device policy allows)</div>
            </div>
            <Controller
              control={form.control}
              name="autoUninstall"
              render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Uninstall automatically" />}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? "Save changes" : "Add to blacklist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
