"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Building2, Eye, EyeOff, KeyRound, Loader2, Mail, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Field } from "@/components/common/misc";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth, type LoginResult } from "@/lib/auth";
import type { AuthMethods } from "@/types/api";

const emailSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
const ldapSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/dashboard";
  return next;
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [show, setShow] = React.useState(false);
  const { invalid, ...rest } = props;
  return (
    <div className="relative">
      <Input {...rest} type={show ? "text" : "password"} aria-invalid={invalid || undefined} className="pr-9" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const network = error instanceof ApiError && error.isNetwork;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
      {network ? <WifiOff className="mt-0.5 size-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0" />}
      <span>{errorMessage(error, "Sign in failed")}</span>
    </div>
  );
}

function SsoIcon({ id }: { id: string }) {
  if (id === "azure-ad") {
    return (
      <svg viewBox="0 0 23 23" className="size-4" aria-hidden>
        <path fill="#f35325" d="M1 1h10v10H1z" />
        <path fill="#81bc06" d="M12 1h10v10H12z" />
        <path fill="#05a6f0" d="M1 12h10v10H1z" />
        <path fill="#ffba08" d="M12 12h10v10H12z" />
      </svg>
    );
  }
  return <KeyRound className="size-4" />;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { login, ldapLogin, status } = useAuth();
  const [tab, setTab] = React.useState("local");
  const [submitError, setSubmitError] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);

  const methods = useQuery({
    queryKey: ["auth", "methods"],
    queryFn: () => api.get<AuthMethods>("/auth/methods", undefined, { anonymous: true }),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const emailForm = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: "", password: "" } });
  const ldapForm = useForm<z.infer<typeof ldapSchema>>({ resolver: zodResolver(ldapSchema), defaultValues: { username: "", password: "" } });

  const afterLogin = (res: LoginResult) => {
    if (res.mfaRequired) {
      router.push(`/login/mfa?next=${encodeURIComponent(next)}`);
    } else if (res.mfaEnrollmentRequired) {
      router.replace("/settings?tab=security&enroll=1");
    } else {
      router.replace(next);
    }
  };

  const onEmail = emailForm.handleSubmit(async (v) => {
    setSubmitError(null);
    try {
      afterLogin(await login(v.email, v.password));
    } catch (e) {
      setSubmitError(e);
      emailForm.setValue("password", "");
    }
  });

  const onLdap = ldapForm.handleSubmit(async (v) => {
    setSubmitError(null);
    try {
      afterLogin(await ldapLogin(v.username, v.password));
    } catch (e) {
      setSubmitError(e);
      ldapForm.setValue("password", "");
    }
  });

  const providers = methods.data?.sso ?? [];
  // Default to showing the directory tab until we know (avoids a flash of it
  // disappearing); hide it once the API confirms LDAP is not configured.
  const ldapEnabled = methods.data ? methods.data.ldap : false;
  const apiDown = methods.isError && methods.error instanceof ApiError && methods.error.isNetwork;

  // If the directory tab is selected but LDAP turns out to be unavailable, fall back to email.
  React.useEffect(() => {
    if (methods.data && !methods.data.ldap && tab === "ldap") setTab("local");
  }, [methods.data, tab]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to the console</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use your organization account to continue.</p>
      </div>

      {apiDown && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-sev-medium/35 bg-sev-medium/10 px-3 py-2 text-xs">
          <WifiOff className="mt-0.5 size-3.5 shrink-0 text-sev-medium" />
          <span>The SecureEndpoint API is currently unreachable. Sign-in will be available once the backend service is running.</span>
        </div>
      )}

      {providers.length > 0 && (
        <>
          <div className="grid gap-2">
            {providers.map((p) => (
              <Button key={p.id} variant="outline" className="w-full justify-center" asChild>
                <a href={p.loginUrl}>
                  <SsoIcon id={p.id} /> Continue with {p.name}
                </a>
              </Button>
            ))}
          </div>
          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Separator className="flex-1" /> or <Separator className="flex-1" />
          </div>
        </>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setSubmitError(null);
        }}
      >
        {ldapEnabled && (
          <TabsList variant="pill" className="grid w-full grid-cols-2">
            <TabsTrigger value="local">
              <Mail /> Email
            </TabsTrigger>
            <TabsTrigger value="ldap">
              <Building2 /> Directory
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="local">
          <form onSubmit={onEmail} className="grid gap-4" noValidate>
            <Field label="Work email" htmlFor="email" error={emailForm.formState.errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="name@company.com"
                autoFocus
                aria-invalid={!!emailForm.formState.errors.email || undefined}
                {...emailForm.register("email")}
              />
            </Field>
            <Field label="Password" htmlFor="password" error={emailForm.formState.errors.password?.message}>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                invalid={!!emailForm.formState.errors.password}
                {...emailForm.register("password")}
              />
            </Field>
            <FormError error={submitError} />
            <Button type="submit" className="w-full" loading={emailForm.formState.isSubmitting}>
              Sign in
            </Button>
          </form>
        </TabsContent>

        {ldapEnabled && (
        <TabsContent value="ldap">
          <form onSubmit={onLdap} className="grid gap-4" noValidate>
            <Field
              label="Directory username"
              htmlFor="username"
              error={ldapForm.formState.errors.username?.message}
              hint="LDAP / Active Directory account, e.g. CORP\jdoe or jdoe@corp.local"
            >
              <Input
                id="username"
                autoComplete="username"
                placeholder="CORP\\username"
                aria-invalid={!!ldapForm.formState.errors.username || undefined}
                {...ldapForm.register("username")}
              />
            </Field>
            <Field label="Password" htmlFor="ldap-password" error={ldapForm.formState.errors.password?.message}>
              <PasswordInput
                id="ldap-password"
                autoComplete="current-password"
                invalid={!!ldapForm.formState.errors.password}
                {...ldapForm.register("password")}
              />
            </Field>
            <FormError error={submitError} />
            <Button type="submit" className="w-full" loading={ldapForm.formState.isSubmitting}>
              Sign in with directory
            </Button>
          </form>
        </TabsContent>
        )}
      </Tabs>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Forgot your password or locked out? Contact your IT administrator.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
