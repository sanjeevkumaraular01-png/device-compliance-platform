"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Plus, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments, usePolicies } from "@/hooks/use-lookups";
import { OS_PLATFORMS, type CreateEnrollmentTokenInput, type CreatedEnrollmentToken, type OsPlatform } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CopyButton, Field } from "@/components/common/misc";
import { formatDateTime, platformLabel } from "@/lib/format";
import { CaCertNote, InstallCommandTabs } from "@/components/enrollment/install-command";

const NONE = "__none__";

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Max 100 characters"),
  platform: z.string(),
  departmentId: z.string(),
  policyId: z.string(),
  maxUses: z.coerce.number({ invalid_type_error: "Enter a number" }).int("Whole number").min(1, "At least 1").max(100000, "At most 100,000"),
  expiresInDays: z.coerce.number({ invalid_type_error: "Enter a number" }).int("Whole number").min(1, "At least 1 day").max(365, "At most 365 days"),
  autoApprove: z.boolean(),
});

type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const DEFAULTS: FormIn = { name: "", platform: NONE, departmentId: NONE, policyId: NONE, maxUses: 100, expiresInDays: 30, autoApprove: true };

export function CreateTokenDialog() {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedEnrollmentToken | null>(null);
  const departments = useDepartments(open);
  const policies = usePolicies(open);

  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });
  const { register, control, handleSubmit, formState, reset } = form;

  const create = useApiMutation((body: CreateEnrollmentTokenInput) => api.post<CreatedEnrollmentToken>("/enrollment/tokens", body), {
    success: "Enrollment token created",
    invalidate: [["enrollment"]],
    onSuccess: (data) => setCreated(data),
  });

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      // Clear the secret from memory once the dialog is dismissed.
      setTimeout(() => {
        setCreated(null);
        reset(DEFAULTS);
      }, 200);
    }
  };

  const onSubmit = (v: FormOut) => {
    create.mutate({
      name: v.name,
      platform: v.platform === NONE ? undefined : (v.platform as OsPlatform),
      departmentId: v.departmentId === NONE ? undefined : v.departmentId,
      policyId: v.policyId === NONE ? undefined : v.policyId,
      maxUses: v.maxUses,
      expiresInDays: v.expiresInDays,
      autoApprove: v.autoApprove,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Create token
        </Button>
      </DialogTrigger>
      <DialogContent className={created ? "sm:max-w-2xl" : "sm:max-w-lg"} onInteractOutside={(e) => {
          if (created) e.preventDefault();
        }}
      >
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" /> Token “{created.name}” created
              </DialogTitle>
              <DialogDescription>
                Valid until {formatDateTime(created.expiresAt)} · up to {created.maxUses} enrollments
                {created.platform ? ` · ${platformLabel[created.platform]} only` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 rounded-md border border-sev-medium/40 bg-sev-medium/10 p-3">
              <p className="flex items-start gap-2 text-sm font-medium">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-sev-medium" />
                Copy this token now — it will not be shown again.
              </p>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                Only a hash is stored on the server. Treat it like a password: anyone holding it can enroll devices into your tenant
                until it expires, is exhausted or is revoked.
              </p>
              <div className="mt-3 flex min-w-0 items-center gap-2">
                <Input
                  readOnly
                  value={created.token}
                  aria-label="Enrollment token"
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 bg-card font-mono text-xs"
                />
                <CopyButton value={created.token} label="Copy token" size="sm" />
              </div>
            </div>

            <div className="grid min-w-0 gap-2">
              <p className="text-sm font-medium">Install command</p>
              <InstallCommandTabs tokenId={created.id} defaultPlatform={created.platform} />
              <CaCertNote />
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>I have saved the token</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Create enrollment token</DialogTitle>
              <DialogDescription>Devices use this token once to register with the console and receive their agent credentials.</DialogDescription>
            </DialogHeader>

            <Field label="Name" htmlFor="tok-name" required error={formState.errors.name?.message}>
              <Input id="tok-name" placeholder="e.g. Finance laptops – Q4 rollout" autoFocus {...register("name")} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Platform" htmlFor="tok-platform" hint="Restrict to one OS (optional).">
                <Controller
                  control={control}
                  name="platform"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="tok-platform">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Any platform</SelectItem>
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
              <Field label="Department" htmlFor="tok-dept" hint="Enrolled devices join this department.">
                <Controller
                  control={control}
                  name="departmentId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="tok-dept">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {(departments.data ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Policy" htmlFor="tok-policy" hint="Overrides the department / default policy.">
                <Controller
                  control={control}
                  name="policyId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="tok-policy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Inherit (department / default)</SelectItem>
                        {(policies.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Max uses" htmlFor="tok-max" error={formState.errors.maxUses?.message}>
                  <Input id="tok-max" type="number" inputMode="numeric" min={1} {...register("maxUses")} />
                </Field>
                <Field label="Expires in (days)" htmlFor="tok-exp" error={formState.errors.expiresInDays?.message}>
                  <Input id="tok-exp" type="number" inputMode="numeric" min={1} max={365} {...register("expiresInDays")} />
                </Field>
              </div>
            </div>

            <Controller
              control={control}
              name="autoApprove"
              render={({ field }) => (
                <label htmlFor="tok-auto" className="flex cursor-pointer items-start justify-between gap-4 rounded-md border p-3">
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">Auto-approve devices</span>
                    <span className="text-xs text-muted-foreground">
                      When off, devices enrolled with this token wait in “Pending approval” until an administrator verifies them.
                    </span>
                  </span>
                  <Switch id="tok-auto" checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
