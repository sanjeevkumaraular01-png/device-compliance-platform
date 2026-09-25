"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { usePolicies } from "@/hooks/use-lookups";
import type { DevicePolicy } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { POLICY_DEFAULTS, pickEditable, type PolicyEditable } from "@/components/policies/policy-fields";

const BASELINE = "__baseline__";

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Max 100 characters"),
  description: z.string().trim().max(500, "Max 500 characters"),
  base: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function NewPolicyDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const policies = usePolicies(open);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", base: BASELINE } });
  const { register, control, handleSubmit, formState, reset } = form;

  const create = useApiMutation((body: PolicyEditable) => api.post<DevicePolicy>("/policies", body), {
    success: (p) => `Policy “${p.name}” created`,
    invalidate: [["policies"]],
    onSuccess: (p) => {
      setOpen(false);
      reset();
      router.push(`/policies/${p.id}`);
    },
  });

  const onSubmit = (v: FormValues) => {
    const source = v.base === BASELINE ? undefined : policies.data?.find((p) => p.id === v.base);
    const settings = source ? pickEditable(source) : POLICY_DEFAULTS;
    create.mutate({ ...settings, name: v.name, description: v.description || null });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New policy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New device policy</DialogTitle>
            <DialogDescription>The policy is created with the settings below; you can fine-tune every control in the editor afterwards.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="np-name" required error={formState.errors.name?.message}>
            <Input id="np-name" autoFocus placeholder="e.g. Engineering workstations" {...register("name")} />
          </Field>
          <Field label="Description" htmlFor="np-desc" error={formState.errors.description?.message}>
            <Textarea id="np-desc" rows={3} placeholder="Who this policy applies to and why" {...register("description")} />
          </Field>
          <Field label="Start from" htmlFor="np-base" hint="Recommended baseline enforces encryption, AV, EDR, firewall, USB blocking and a 5-minute screen lock.">
            <Controller
              control={control}
              name="base"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="np-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BASELINE}>Recommended baseline</SelectItem>
                    {(policies.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        Copy of {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create &amp; edit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
