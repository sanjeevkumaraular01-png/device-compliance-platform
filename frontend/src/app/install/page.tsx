"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MonitorDown,
  PackageOpen,
  RotateCcw,
  ShieldCheck,
  Terminal,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, CopyButton } from "@/components/common/misc";
import { ShieldLogo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { api, ApiError, errorMessage } from "@/lib/api";
import { complianceMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DeployConfig, DeploySession, DeployStatus } from "@/types/api";

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your work email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

// ─────────────────────────────── Shell ───────────────────────────────

function InstallShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2.5">
          <ShieldLogo />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">SecureEndpoint</div>
            <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Manager</div>
          </div>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 pb-4 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} SecureEndpoint Manager · Authorized use only
      </footer>
    </div>
  );
}

/** A bordered card with an icon header, used for every state below. */
function Panel({
  icon: Icon,
  title,
  description,
  children,
  tone = "primary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  tone?: "primary" | "success" | "muted";
}) {
  const toneCls =
    tone === "success" ? "bg-sev-none/12 text-sev-none" : tone === "muted" ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary";
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className={cn("mb-4 grid size-11 place-items-center rounded-lg", toneCls)}>
        <Icon className="size-5" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
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

function InlineError({ error }: { error: React.ReactNode }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

// ─────────────────────────────── Helpers ───────────────────────────────

/** Turns an ApiError from POST /deploy/session into a friendly, status-specific message. */
function sessionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return "Incorrect company email or password. Use the same password you use for your company mailbox.";
      case 403:
        // Domain-not-allowed: prefer the server's own explanation when present.
        return errorMessage(err, "This email domain isn't allowed for self-service enrollment. Contact your IT administrator.");
      case 429:
        return "Too many attempts. Please wait a few minutes and try again.";
      case 502:
      case 503:
      case 504:
        return "The company mail server can't be reached right now (or isn't configured). Please try again shortly or contact IT.";
      default:
        return errorMessage(err, "Sign in failed. Please try again.");
    }
  }
  return errorMessage(err, "Sign in failed. Please try again.");
}

/** "expires in N minutes" style label from an ISO timestamp; re-renders every 30s. */
function useExpiryLabel(expiresAt: string | undefined): string | null {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "this link has expired";
  const mins = Math.ceil(ms / 60_000);
  return `expires in ${mins} minute${mins === 1 ? "" : "s"}`;
}

// ─────────────────────────────── Steps ───────────────────────────────

function SignInStep({
  companyName,
  onSuccess,
}: {
  companyName: string;
  onSuccess: (session: DeploySession) => void;
}) {
  const [submitError, setSubmitError] = React.useState<React.ReactNode>(null);
  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (v) => {
    setSubmitError(null);
    try {
      const session = await api.post<DeploySession>("/deploy/session", { email: v.email, password: v.password }, { anonymous: true });
      form.reset({ email: "", password: "" }); // never keep the password around
      onSuccess(session);
    } catch (e) {
      setSubmitError(sessionErrorMessage(e));
      form.setValue("password", "");
    }
  });

  return (
    <Panel
      icon={ShieldCheck}
      title="Sign in with your company account"
      description={`Use your ${companyName} email to set up SecureEndpoint on this Windows device.`}
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Work email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="name@company.com"
            autoFocus
            aria-invalid={!!form.formState.errors.email || undefined}
            {...form.register("email")}
          />
        </Field>
        <Field
          label="Password (your company email password)"
          htmlFor="password"
          error={form.formState.errors.password?.message}
          hint="Verified securely with your company mail server. Your password is never stored."
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            invalid={!!form.formState.errors.password}
            {...form.register("password")}
          />
        </Field>
        <InlineError error={submitError} />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Continue
        </Button>
      </form>
    </Panel>
  );
}

function DownloadStep({ session, onReset }: { session: DeploySession; onReset: () => void }) {
  const expiry = useExpiryLabel(session.expiresAt);
  const manualCommand = `msiexec /i SecureEndpoint-Agent-x64.msi SERVER=${session.serverUrl} DEPLOY_TOKEN=${session.deployToken}`;

  const steps = [
    <>Download the installer using a button above.</>,
    <>Run it and approve the Windows administrator prompt.</>,
    <>Wait a moment — this page updates automatically once your device checks in.</>,
  ];

  return (
    <Panel
      icon={MonitorDown}
      title={`Welcome, ${session.employee.email}`}
      description="Install the SecureEndpoint agent to finish enrolling this device."
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Button className="w-full" asChild>
            <a href={session.setupUrl}>
              <Download /> Download &amp; Install (recommended)
            </a>
          </Button>
          <Button variant="outline" className="w-full" asChild>
            <a href={session.downloadUrl}>
              <PackageOpen /> Download MSI
            </a>
          </Button>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Windows 10/11
          {expiry && (
            <>
              <span aria-hidden>·</span>
              <Clock className="size-3.5" /> {expiry}
            </>
          )}
        </div>

        <ol className="grid gap-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">{i + 1}</span>
              <span className="text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>

        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Terminal className="size-3.5 text-muted-foreground" /> Prefer to run it yourself?
          </div>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
              {manualCommand}
            </code>
            <CopyButton value={manualCommand} label="Copy command" className="self-start" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for your device…
          </span>
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw /> Start over
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function CompleteStep({ status }: { status: DeployStatus }) {
  const active = status.state === "ACTIVE";
  const name = status.device?.name ?? "your device";
  return (
    <Panel
      icon={CheckCircle2}
      tone="success"
      title="Installation complete"
      description={
        active ? (
          <>
            Your device <strong className="font-semibold text-foreground">{name}</strong> is registered and active.
          </>
        ) : (
          <>
            Your device <strong className="font-semibold text-foreground">{name}</strong> is registered and waiting for admin approval.
          </>
        )
      }
    >
      <div className="grid gap-3">
        {status.device && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/40 p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Device</dt>
              <dd className="mt-0.5 font-medium">{status.device.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Operating system</dt>
              <dd className="mt-0.5 font-medium">{status.device.os ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="mt-0.5 font-medium">{active ? "Active" : "Pending approval"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Compliance</dt>
              <dd className="mt-0.5 font-medium">{complianceMeta[status.device.complianceState]?.label ?? "Unknown"}</dd>
            </div>
          </dl>
        )}
        <p className="text-sm text-muted-foreground">You can close this window.</p>
      </div>
    </Panel>
  );
}

// ─────────────────────────────── Page ───────────────────────────────

export default function InstallPage() {
  const [session, setSession] = React.useState<DeploySession | null>(null);

  const config = useQuery({
    queryKey: ["deploy", "config"],
    queryFn: ({ signal }) => api.get<DeployConfig>("/deploy/config", undefined, { anonymous: true, signal }),
    retry: false,
    staleTime: 60_000,
  });

  // Poll enrollment status once we have a deployment credential. Stops on any terminal state.
  const status = useQuery({
    queryKey: ["deploy", "status", session?.deployToken],
    queryFn: ({ signal }) =>
      api.get<DeployStatus>("/deploy/status", { token: session!.deployToken }, { anonymous: true, signal }),
    enabled: !!session,
    retry: false,
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s === "ENROLLED_PENDING_APPROVAL" || s === "ACTIVE" || s === "EXPIRED" ? false : 5_000;
    },
    refetchIntervalInBackground: true,
  });

  // If the credential expires before the device enrolls, drop back to the sign-in step.
  React.useEffect(() => {
    if (session && status.data?.state === "EXPIRED") setSession(null);
  }, [session, status.data?.state]);

  // Loading the public config.
  if (config.isLoading) {
    return (
      <InstallShell>
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </InstallShell>
    );
  }

  // API unreachable / unexpected error fetching config.
  if (config.isError) {
    const network = config.error instanceof ApiError && config.error.isNetwork;
    return (
      <InstallShell>
        <Panel
          icon={WifiOff}
          tone="muted"
          title="We can't reach the enrollment service"
          description={
            network
              ? "The enrollment service is temporarily unavailable. Please try again in a few minutes, or contact your IT administrator."
              : errorMessage(config.error, "Something went wrong. Please try again shortly.")
          }
        >
          <Button variant="outline" className="w-full" onClick={() => config.refetch()}>
            <RotateCcw /> Try again
          </Button>
        </Panel>
      </InstallShell>
    );
  }

  // Feature disabled by the admin.
  if (!config.data?.enabled) {
    return (
      <InstallShell>
        <Panel
          icon={PackageOpen}
          tone="muted"
          title="Self-service enrollment isn't set up yet"
          description="This organization hasn't enabled device self-enrollment. Please contact your IT administrator to get set up."
        />
      </InstallShell>
    );
  }

  const state = status.data?.state;
  const enrolled = state === "ENROLLED_PENDING_APPROVAL" || state === "ACTIVE";

  return (
    <InstallShell>
      {!session ? (
        <SignInStep
          companyName={config.data.companyName || "company"}
          onSuccess={setSession}
        />
      ) : enrolled && status.data ? (
        <CompleteStep status={status.data} />
      ) : (
        <DownloadStep session={session} onReset={() => setSession(null)} />
      )}
    </InstallShell>
  );
}
