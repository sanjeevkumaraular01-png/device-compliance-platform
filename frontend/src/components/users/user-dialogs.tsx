"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { ROLE_KEYS, type CreateUserInput, type RoleKey, type UpdateUserInput, type User } from "@/types/api";
import { roleMeta } from "@/components/users/role-meta";
import { PASSWORD_POLICY_MESSAGE, PasswordChecklist, isStrongPassword } from "@/components/settings/password-policy";

const NONE = "__none";

const baseFields = {
  displayName: z.string().trim().min(1, "Display name is required").max(200),
  roleKey: z.enum(ROLE_KEYS),
  departmentId: z.string().optional(),
  jobTitle: z.string().trim().max(200).optional(),
  phone: z
    .string()
    .trim()
    .max(50)
    .regex(/^[+()\d\s.-]*$/, "Use digits, spaces and + ( ) - only")
    .optional(),
};

const createSchema = z.object({
  ...baseFields,
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address").max(254),
  password: z
    .string()
    .optional()
    .refine((v) => !v || isStrongPassword(v), PASSWORD_POLICY_MESSAGE),
});
type CreateValues = z.infer<typeof createSchema>;

const editSchema = z.object({ ...baseFields, isActive: z.boolean() });
type EditValues = z.infer<typeof editSchema>;

function RoleSelect({ id, value, onChange, invalid }: { id: string; value: RoleKey; onChange: (v: RoleKey) => void; invalid?: boolean }) {
  const { user } = useAuth();
  // Only a Super Admin can grant Super Admin.
  const options = ROLE_KEYS.filter((k) => k !== "SUPER_ADMIN" || user?.role === "SUPER_ADMIN" || value === "SUPER_ADMIN");
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RoleKey)}>
      <SelectTrigger id={id} aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((k) => (
          <SelectItem key={k} value={k}>
            {roleMeta[k].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DepartmentSelect({ id, value, onChange }: { id: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const departments = useDepartments();
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={departments.isLoading ? "Loading…" : "No department"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No department</SelectItem>
        {(departments.data ?? []).map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─────────────────────────────── Create ───────────────────────────────

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4 text-primary" /> Add user
          </DialogTitle>
          <DialogDescription>Creates a local console account. Directory (LDAP / SSO) users are provisioned on first sign-in.</DialogDescription>
        </DialogHeader>
        <CreateUserForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [showPw, setShowPw] = React.useState(false);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: "", displayName: "", roleKey: "EMPLOYEE", departmentId: undefined, jobTitle: "", phone: "", password: "" },
  });
  const { register, control, handleSubmit, watch, formState } = form;
  const errors = formState.errors;
  const password = watch("password") ?? "";

  const create = useApiMutation((input: CreateUserInput) => api.post<User>("/users", input), {
    success: (u) => `User ${u?.displayName ?? ""} created`.trim(),
    invalidate: [["users"], ["departments"]],
    onSuccess: onDone,
  });

  const onSubmit = handleSubmit((v) =>
    create.mutate({
      email: v.email.trim().toLowerCase(),
      displayName: v.displayName,
      roleKey: v.roleKey,
      departmentId: v.departmentId || undefined,
      jobTitle: v.jobTitle || undefined,
      phone: v.phone || undefined,
      password: v.password || undefined,
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Email" htmlFor="cu-email" required error={errors.email?.message}>
          <Input id="cu-email" type="email" autoComplete="off" {...register("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Display name" htmlFor="cu-name" required error={errors.displayName?.message}>
          <Input id="cu-name" autoComplete="off" {...register("displayName")} aria-invalid={!!errors.displayName} />
        </Field>
        <Field label="Role" htmlFor="cu-role" required error={errors.roleKey?.message}>
          <Controller control={control} name="roleKey" render={({ field }) => <RoleSelect id="cu-role" value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Department" htmlFor="cu-dept">
          <Controller
            control={control}
            name="departmentId"
            render={({ field }) => <DepartmentSelect id="cu-dept" value={field.value} onChange={field.onChange} />}
          />
        </Field>
        <Field label="Job title" htmlFor="cu-title" error={errors.jobTitle?.message}>
          <Input id="cu-title" {...register("jobTitle")} />
        </Field>
        <Field label="Phone" htmlFor="cu-phone" error={errors.phone?.message}>
          <Input id="cu-phone" type="tel" {...register("phone")} aria-invalid={!!errors.phone} />
        </Field>
      </div>

      <Field
        label="Initial password"
        htmlFor="cu-password"
        error={errors.password?.message}
        hint="Optional. Leave empty for directory / SSO users or to let them set one via password reset."
      >
        <div className="relative">
          <Input
            id="cu-password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            className="pr-9"
            {...register("password")}
            aria-invalid={!!errors.password}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </Field>
      {password && <PasswordChecklist value={password} className="-mt-2" />}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create user
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─────────────────────────────── Edit ───────────────────────────────

export function EditUserSheet({ user, open, onOpenChange }: { user: User | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open && !!user} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-md">
        {user && <EditUserForm key={user.id} user={user} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function EditUserForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { user: me } = useAuth();
  const isSelf = me?.id === user.id;
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      displayName: user.displayName,
      roleKey: user.role?.key ?? "EMPLOYEE",
      departmentId: user.departmentId ?? undefined,
      jobTitle: user.jobTitle ?? "",
      phone: user.phone ?? "",
      isActive: user.isActive,
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const update = useApiMutation((input: UpdateUserInput) => api.patch<User>(`/users/${user.id}`, input), {
    success: `User ${user.displayName} updated`,
    invalidate: [["users"], ["departments"]],
    onSuccess: onDone,
  });

  const onSubmit = handleSubmit((v) => {
    const dirty = formState.dirtyFields;
    const body: UpdateUserInput = {};
    if (dirty.displayName) body.displayName = v.displayName;
    if (dirty.roleKey) body.roleKey = v.roleKey;
    if (dirty.departmentId) body.departmentId = v.departmentId ?? null;
    if (dirty.jobTitle) body.jobTitle = v.jobTitle || null;
    if (dirty.phone) body.phone = v.phone || null;
    if (dirty.isActive) body.isActive = v.isActive;
    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    update.mutate(body);
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>Edit user</SheetTitle>
        <SheetDescription className="truncate">{user.email}</SheetDescription>
      </SheetHeader>
      <SheetBody className="grid content-start gap-4 pt-4">
        <Field label="Display name" htmlFor="eu-name" required error={errors.displayName?.message}>
          <Input id="eu-name" {...register("displayName")} aria-invalid={!!errors.displayName} />
        </Field>
        <Field label="Role" htmlFor="eu-role" hint={isSelf ? "You cannot change your own role." : undefined}>
          <Controller
            control={control}
            name="roleKey"
            render={({ field }) =>
              isSelf ? (
                <Input id="eu-role" value={roleMeta[field.value].label} disabled readOnly />
              ) : (
                <RoleSelect id="eu-role" value={field.value} onChange={field.onChange} />
              )
            }
          />
        </Field>
        <Field label="Department" htmlFor="eu-dept">
          <Controller
            control={control}
            name="departmentId"
            render={({ field }) => <DepartmentSelect id="eu-dept" value={field.value} onChange={field.onChange} />}
          />
        </Field>
        <Field label="Job title" htmlFor="eu-title" error={errors.jobTitle?.message}>
          <Input id="eu-title" {...register("jobTitle")} />
        </Field>
        <Field label="Phone" htmlFor="eu-phone" error={errors.phone?.message}>
          <Input id="eu-phone" type="tel" {...register("phone")} aria-invalid={!!errors.phone} />
        </Field>
        <Controller
          control={control}
          name="isActive"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <div>
                <Label htmlFor="eu-active">Account active</Label>
                <p className="text-xs text-muted-foreground">
                  {isSelf ? "You cannot deactivate your own account." : "Inactive users cannot sign in; their sessions are revoked."}
                </p>
              </div>
              <Switch id="eu-active" checked={field.value} onCheckedChange={field.onChange} disabled={isSelf} />
            </div>
          )}
        />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
          Save changes
        </Button>
      </SheetFooter>
    </form>
  );
}
