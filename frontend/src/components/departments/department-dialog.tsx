"use client";

import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2 } from "lucide-react";
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
import type { Department, DepartmentInput } from "@/types/api";
import { UserPicker } from "@/components/users/user-picker";

const NONE = "__none";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, "Use uppercase letters, digits, - or _"),
  description: z.string().trim().max(1000).optional(),
  managerId: z.string().optional(),
  policyId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function DepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  /** null = create */
  department: Department | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> {department ? "Edit department" : "New department"}
          </DialogTitle>
          <DialogDescription>
            Departments scope what managers can see and can carry a default device policy for their members&apos; devices.
          </DialogDescription>
        </DialogHeader>
        <DepartmentForm key={department?.id ?? "new"} department={department} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DepartmentForm({ department, onDone }: { department: Department | null; onDone: () => void }) {
  const { can } = useAuth();
  const policies = usePolicies();
  const canReadPolicies = can("policies:read");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: department?.name ?? "",
      code: department?.code ?? "",
      description: department?.description ?? "",
      managerId: department?.managerId ?? undefined,
      policyId: department?.policyId ?? undefined,
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation(
    (input: DepartmentInput) =>
      department ? api.patch<Department>(`/departments/${department.id}`, input) : api.post<Department>("/departments", input),
    {
      success: (_d, v) => (department ? `Department ${v.name} updated` : `Department ${v.name} created`),
      invalidate: [["departments"], ["users"]],
      onSuccess: onDone,
    },
  );

  const onSubmit = handleSubmit((v) =>
    save.mutate({
      name: v.name,
      code: v.code.toUpperCase(),
      description: v.description || null,
      managerId: v.managerId ?? null,
      policyId: v.policyId ?? null,
    }),
  );

  const codeField = register("code");

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="Name" htmlFor="dep-name" required error={errors.name?.message}>
          <Input id="dep-name" {...register("name")} aria-invalid={!!errors.name} placeholder="Finance" />
        </Field>
        <Field label="Code" htmlFor="dep-code" required error={errors.code?.message}>
          <Input
            id="dep-code"
            {...codeField}
            onChange={(e) => {
              e.target.value = e.target.value.toUpperCase().replace(/\s+/g, "_");
              void codeField.onChange(e);
            }}
            className="font-mono uppercase"
            placeholder="FIN"
            aria-invalid={!!errors.code}
          />
        </Field>
      </div>
      <Field label="Description" htmlFor="dep-desc" error={errors.description?.message}>
        <Textarea id="dep-desc" rows={2} {...register("description")} />
      </Field>
      <Field label="Manager" htmlFor="dep-manager" hint="Department managers see devices, users and events of this department.">
        <Controller
          control={control}
          name="managerId"
          render={({ field }) => (
            <UserPicker
              id="dep-manager"
              value={field.value}
              onChange={(id) => field.onChange(id)}
              selectedLabel={department?.manager?.displayName}
              placeholder="No manager"
            />
          )}
        />
      </Field>
      <Field
        label="Device policy"
        htmlFor="dep-policy"
        hint={canReadPolicies ? "Applied to devices in this department that have no policy of their own." : "You do not have permission to view policies."}
      >
        <Controller
          control={control}
          name="policyId"
          render={({ field }) => (
            <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? undefined : v)} disabled={!canReadPolicies}>
              <SelectTrigger id="dep-policy">
                <SelectValue placeholder={policies.isLoading ? "Loading…" : "Default policy"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Inherit default policy</SelectItem>
                {(policies.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
                {field.value && !policies.data?.some((p) => p.id === field.value) && department?.policy && (
                  <SelectItem value={field.value}>{department.policy.name}</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {department ? "Save changes" : "Create department"}
        </Button>
      </DialogFooter>
    </form>
  );
}
