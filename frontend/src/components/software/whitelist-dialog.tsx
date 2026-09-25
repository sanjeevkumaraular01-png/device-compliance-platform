"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { humanize, platformLabel, toIsoDateInput } from "@/lib/format";
import { MATCH_TYPES, OS_PLATFORMS, type SoftwareWhitelist, type SoftwareWhitelistInput } from "@/types/api";

export const LICENSE_TYPES = ["FREE", "PER_SEAT", "SITE", "SUBSCRIPTION"] as const;

/** License types that have a seat count / per-seat cost. */
function licensedType(t: string) {
  return t !== "NONE" && t !== "FREE";
}

export const matchTypeHelp: Record<(typeof MATCH_TYPES)[number], string> = {
  EXACT: "Name must match exactly (case-insensitive)",
  CONTAINS: "Name contains this text",
  REGEX: "Name matches this regular expression",
};

const schema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    publisher: z.string().trim().max(200),
    matchType: z.enum(MATCH_TYPES),
    minVersion: z.string().trim().max(50),
    category: z.string().trim().max(100),
    platform: z.enum(["ANY", ...OS_PLATFORMS]),
    licenseType: z.enum(["NONE", ...LICENSE_TYPES]),
    licenseCount: z.string().trim().regex(/^\d*$/, "Whole number"),
    licenseExpiresAt: z.string(),
    costPerSeat: z.string().trim().regex(/^\d*(\.\d{1,2})?$/, "Amount, e.g. 12.50"),
    vendorUrl: z.union([z.literal(""), z.string().trim().url("Enter a valid URL (https://…)")]),
    notes: z.string().trim().max(2000),
    licenseKey: z.string().max(500),
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

function toForm(e?: SoftwareWhitelist | null): FormValues {
  const lt = e?.licenseType && (LICENSE_TYPES as readonly string[]).includes(e.licenseType) ? (e.licenseType as FormValues["licenseType"]) : "NONE";
  return {
    name: e?.name ?? "",
    publisher: e?.publisher ?? "",
    matchType: e?.matchType ?? "CONTAINS",
    minVersion: e?.minVersion ?? "",
    category: e?.category ?? "",
    platform: e?.platform ?? "ANY",
    licenseType: lt,
    licenseCount: e?.licenseCount !== null && e?.licenseCount !== undefined ? String(e.licenseCount) : "",
    licenseExpiresAt: toIsoDateInput(e?.licenseExpiresAt),
    costPerSeat: e?.costPerSeat !== null && e?.costPerSeat !== undefined ? String(e.costPerSeat) : "",
    vendorUrl: e?.vendorUrl ?? "",
    notes: e?.notes ?? "",
    licenseKey: "",
  };
}

export function SoftwareWhitelistDialog({
  open,
  onOpenChange,
  entry,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entry: SoftwareWhitelist | null;
}) {
  const editing = !!entry;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(entry) });
  const errors = form.formState.errors;
  const licenseType = form.watch("licenseType");
  const matchType = form.watch("matchType");

  React.useEffect(() => {
    if (open) form.reset(toForm(entry));
  }, [open, entry, form]);

  const mutation = useApiMutation(
    (body: SoftwareWhitelistInput) =>
      entry ? api.patch<SoftwareWhitelist>(`/software/whitelist/${entry.id}`, body) : api.post<SoftwareWhitelist>("/software/whitelist", body),
    {
      success: editing ? "Catalog entry updated" : "Software added to the approved catalog",
      invalidate: [["software"]],
      onSuccess: () => onOpenChange(false),
    },
  );

  const onSubmit = form.handleSubmit((v) => {
    const s = (x: string) => (x ? x : null);
    const body: SoftwareWhitelistInput = {
      name: v.name,
      publisher: s(v.publisher),
      matchType: v.matchType,
      minVersion: s(v.minVersion),
      category: s(v.category),
      platform: v.platform === "ANY" ? null : v.platform,
      licenseType: v.licenseType === "NONE" ? null : v.licenseType,
      licenseCount: licensedType(v.licenseType) && v.licenseCount ? Number(v.licenseCount) : null,
      licenseExpiresAt: v.licenseExpiresAt ? new Date(`${v.licenseExpiresAt}T00:00:00.000Z`).toISOString() : null,
      costPerSeat: licensedType(v.licenseType) && v.costPerSeat ? Number(v.costPerSeat) : null,
      vendorUrl: s(v.vendorUrl),
      notes: s(v.notes),
    };
    // licenseKey is write-only: only sent when (re-)entered.
    if (v.licenseKey.trim()) body.licenseKey = v.licenseKey.trim();
    mutation.mutate(body);
  });

  const licensed = licensedType(licenseType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit approved software" : "Add approved software"}</DialogTitle>
          <DialogDescription>Matching installations are classified as Approved. License data drives the Licenses compliance view.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="sw-name" error={errors.name?.message} required>
              <Input id="sw-name" placeholder="Google Chrome" aria-invalid={!!errors.name || undefined} {...form.register("name")} />
            </Field>
            <Field label="Publisher" htmlFor="sw-publisher" error={errors.publisher?.message}>
              <Input id="sw-publisher" placeholder="Google LLC" {...form.register("publisher")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Match type" htmlFor="sw-match" hint={matchTypeHelp[matchType]}>
              <Controller
                control={form.control}
                name="matchType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="sw-match">
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
            <Field label="Minimum version" htmlFor="sw-minver" error={errors.minVersion?.message} hint="Older versions are unauthorized">
              <Input id="sw-minver" placeholder="120.0" className="font-mono" {...form.register("minVersion")} />
            </Field>
            <Field label="Platform" htmlFor="sw-platform">
              <Controller
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="sw-platform">
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
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="sw-category" error={errors.category?.message}>
              <Input id="sw-category" placeholder="Browser" {...form.register("category")} />
            </Field>
            <Field label="Vendor URL" htmlFor="sw-url" error={errors.vendorUrl?.message}>
              <Input id="sw-url" type="url" placeholder="https://" aria-invalid={!!errors.vendorUrl || undefined} {...form.register("vendorUrl")} />
            </Field>
          </div>

          <Separator />
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Licensing</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="License type" htmlFor="sw-lictype">
              <Controller
                control={form.control}
                name="licenseType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="sw-lictype">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Not tracked</SelectItem>
                      {LICENSE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {humanize(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Seats purchased" htmlFor="sw-count" error={errors.licenseCount?.message}>
              <Input id="sw-count" inputMode="numeric" placeholder={licensed ? "e.g. 250" : "—"} {...form.register("licenseCount")} />
            </Field>
            <Field label="License expiry" htmlFor="sw-expiry">
              <Input id="sw-expiry" type="date" {...form.register("licenseExpiresAt")} />
            </Field>
            <Field label="Cost per seat (USD)" htmlFor="sw-cost" error={errors.costPerSeat?.message}>
              <Input id="sw-cost" inputMode="decimal" placeholder="0.00" {...form.register("costPerSeat")} />
            </Field>
          </div>
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                <KeyRound className="size-3.5" /> License key
              </span>
            }
            htmlFor="sw-key"
            hint={editing ? "Stored encrypted and never displayed. Leave empty to keep the current key; type a new one to replace it." : "Stored encrypted and never displayed again."}
          >
            <Input id="sw-key" type="password" autoComplete="new-password" placeholder={editing ? "•••• stored" : "Optional"} className="font-mono" {...form.register("licenseKey")} />
          </Field>
          <Field label="Notes" htmlFor="sw-notes" error={errors.notes?.message}>
            <Textarea id="sw-notes" rows={2} {...form.register("notes")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? "Save changes" : "Add to catalog"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
