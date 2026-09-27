"use client";

import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { usePolicies } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { WorkProfile, WorkProfileInput, WorkProfileKey } from "@/types/api";

const NONE = "__none";
const KEYS: WorkProfileKey[] = ["SALES", "HR", "FINANCE", "DEVELOPER", "MANAGEMENT", "SUPPORT", "CUSTOM"];

const schema = z.object({
  key: z.enum(["SALES", "HR", "FINANCE", "DEVELOPER", "MANAGEMENT", "SUPPORT", "CUSTOM"]),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
  policyId: z.string().optional(),
  requiredSoftware: z.string().optional(),
  prohibitedSoftware: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const toLines = (v?: string) =>
  (v ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function WorkProfileDialog({
  profile,
  open,
  onOpenChange,
}: {
  /** null = create */
  profile: WorkProfile | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="size-4 text-primary" /> {profile ? "Edit work profile" : "New work profile"}
          </DialogTitle>
          <DialogDescription>
            A work profile applies its device policy automatically to the devices of employees assigned to it, and records the software the role is
            expected to have.
          </DialogDescription>
        </DialogHeader>
        <WorkProfileForm key={profile?.id ?? "new"} profile={profile} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function WorkProfileForm({ profile, onDone }: { profile: WorkProfile | null; onDone: () => void }) {
  const { can } = useAuth();
  const policies = usePolicies();
  const canReadPolicies = can("policies:read");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      key: profile?.key ?? "CUSTOM",
      name: profile?.name ?? "",
      description: profile?.description ?? "",
      policyId: profile?.policyId ?? undefined,
      requiredSoftware: (profile?.requiredSoftware ?? []).join("\n"),
      prohibitedSoftware: (profile?.prohibitedSoftware ?? []).join("\n"),
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation(
    (input: WorkProfileInput) =>
      profile ? api.patch<WorkProfile>(`/work-profiles/${profile.id}`, input) : api.post<WorkProfile>("/work-profiles", input),
    {
      success: (_d, v) => (profile ? `Work profile ${v.name} updated` : `Work profile ${v.name} created`),
      invalidate: [["work-profiles"], ["users"]],
      onSuccess: onDone,
    },
  );

  const onSubmit = handleSubmit((v) =>
    save.mutate({
      ...(profile ? {} : { key: v.key }),
      name: v.name,
      description: v.description || null,
      policyId: v.policyId ?? null,
      requiredSoftware: toLines(v.requiredSoftware),
      prohibitedSoftware: toLines(v.prohibitedSoftware),
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Type" htmlFor="wp-key" hint={profile ? "Fixed after creation" : undefined}>
          <Controller
            control={control}
            name="key"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!!profile}>
                <SelectTrigger id="wp-key">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k.charAt(0) + k.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Name" htmlFor="wp-name" required error={errors.name?.message}>
          <Input id="wp-name" {...register("name")} aria-invalid={!!errors.name} placeholder="Sales" />
        </Field>
      </div>
      <Field label="Description" htmlFor="wp-desc" error={errors.description?.message}>
        <Textarea id="wp-desc" rows={2} {...register("description")} placeholder="Field and inside sales staff" />
      </Field>
      <Field
        label="Device policy"
        htmlFor="wp-policy"
        hint={canReadPolicies ? "Applied automatically to devices of employees on this profile (unless the device has its own policy)." : "You do not have permission to view policies."}
      >
        <Controller
          control={control}
          name="policyId"
          render={({ field }) => (
            <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? undefined : v)} disabled={!canReadPolicies}>
              <SelectTrigger id="wp-policy">
                <SelectValue placeholder={policies.isLoading ? "Loading…" : "No policy"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No policy (fall back to department/default)</SelectItem>
                {(policies.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
                {field.value && !policies.data?.some((p) => p.id === field.value) && profile?.policy && (
                  <SelectItem value={field.value}>{profile.policy.name}</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Required software" htmlFor="wp-required" hint="One per line">
          <Textarea id="wp-required" rows={4} {...register("requiredSoftware")} placeholder={"Google Chrome\nSlack"} />
        </Field>
        <Field label="Prohibited software" htmlFor="wp-prohibited" hint="One per line">
          <Textarea id="wp-prohibited" rows={4} {...register("prohibitedSoftware")} placeholder={"uTorrent\nTeamViewer"} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {profile ? "Save changes" : "Create work profile"}
        </Button>
      </DialogFooter>
    </form>
  );
}
