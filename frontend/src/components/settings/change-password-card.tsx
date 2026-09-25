"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { authProviderLabel } from "@/components/audit/audit-meta";
import { PASSWORD_POLICY_MESSAGE, PasswordChecklist, isStrongPassword } from "@/components/settings/password-policy";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
    confirmPassword: z.string().min(1, "Confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "New password must differ from the current one" });
type Values = z.infer<typeof schema>;

export const PASSWORD_ANCHOR = "password";

export function ChangePasswordCard() {
  const { user } = useAuth();
  const [show, setShow] = React.useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { register, handleSubmit, watch, reset, formState } = form;
  const errors = formState.errors;
  const newPassword = watch("newPassword");

  const change = useApiMutation((v: { currentPassword: string; newPassword: string }) => api.post("/auth/change-password", v), {
    success: "Password changed. Other sessions may need to sign in again.",
    invalidate: [["settings", "sessions"]],
    onSuccess: () => reset(),
  });

  const isLocal = user?.authProvider === "LOCAL";

  return (
    <Card id={PASSWORD_ANCHOR} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" /> Password
        </CardTitle>
        <CardDescription>
          {isLocal
            ? "Use at least 12 characters with upper- and lowercase letters, a number and a symbol."
            : `Your password is managed by ${authProviderLabel[user?.authProvider ?? "LOCAL"] ?? "your identity provider"}.`}
        </CardDescription>
      </CardHeader>
      {isLocal ? (
        <form onSubmit={handleSubmit((v) => change.mutate({ currentPassword: v.currentPassword, newPassword: v.newPassword }))} noValidate>
          <CardContent className="grid gap-3">
            <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword?.message}>
              <Input
                id="pw-current"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                {...register("currentPassword")}
                aria-invalid={!!errors.currentPassword}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="New password" htmlFor="pw-new" error={errors.newPassword?.message}>
                <Input
                  id="pw-new"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  {...register("newPassword")}
                  aria-invalid={!!errors.newPassword}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirmPassword?.message}>
                <Input
                  id="pw-confirm"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  {...register("confirmPassword")}
                  aria-invalid={!!errors.confirmPassword}
                />
              </Field>
            </div>
            <PasswordChecklist value={newPassword} />
          </CardContent>
          <CardFooter className="justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
              {show ? <EyeOff /> : <Eye />} {show ? "Hide" : "Show"} passwords
            </Button>
            <Button type="submit" loading={change.isPending}>
              Change password
            </Button>
          </CardFooter>
        </form>
      ) : (
        <CardContent>
          <p className="text-xs text-muted-foreground">Change it through your organization&apos;s account portal. Console passwords do not apply to directory or SSO accounts.</p>
        </CardContent>
      )}
    </Card>
  );
}
