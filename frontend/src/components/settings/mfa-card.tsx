"use client";

import * as React from "react";
import { AlertTriangle, Download, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyButton, Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn, saveBlob } from "@/lib/utils";
import type { MfaSetupResponse } from "@/types/api";

function CodeInput({ id, value, onChange, allowRecovery, autoFocus }: { id: string; value: string; onChange: (v: string) => void; allowRecovery?: boolean; autoFocus?: boolean }) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(allowRecovery ? e.target.value.trim() : e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode={allowRecovery ? "text" : "numeric"}
      autoComplete="one-time-code"
      placeholder={allowRecovery ? "123456 or recovery code" : "123456"}
      className="max-w-[14rem] text-center font-mono text-base tracking-[0.3em]"
      maxLength={allowRecovery ? 64 : 6}
      autoFocus={autoFocus}
    />
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { user } = useAuth();
  const text = codes.join("\n");
  const download = () => {
    const content = [
      "SecureEndpoint Manager — MFA recovery codes",
      `Account: ${user?.email ?? ""}`,
      `Generated: ${formatDateTime(new Date())}`,
      "",
      "Each code can be used once to sign in if you lose access to your authenticator app.",
      "",
      ...codes,
      "",
    ].join("\n");
    saveBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), "secureendpoint-recovery-codes.txt");
  };
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2 rounded-md border border-sev-medium/30 bg-sev-medium/10 px-3 py-2.5 text-xs">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-sev-medium" />
        <span>
          <span className="font-semibold">Save these recovery codes now — they will not be shown again.</span> Each code works once and lets you sign in
          if you lose your authenticator device. Store them in a password manager or another secure place.
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-1.5 rounded-md border bg-muted/40 p-3 sm:grid-cols-3" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c} className="rounded bg-card px-2 py-1 text-center font-mono text-xs ring-1 ring-border">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={text} label="Copy all" size="sm" />
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download /> Download .txt
        </Button>
        <Button type="button" size="sm" className="ml-auto" onClick={onDone}>
          I&apos;ve saved my codes
        </Button>
      </div>
    </div>
  );
}

export function MfaCard({ enrollRequired }: { enrollRequired?: boolean }) {
  const { user, reload } = useAuth();
  const [setup, setSetup] = React.useState<MfaSetupResponse | null>(null);
  const [code, setCode] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disableCode, setDisableCode] = React.useState("");

  const start = useApiMutation(() => api.post<MfaSetupResponse>("/auth/mfa/setup"), {
    onSuccess: (data) => {
      setSetup(data);
      setCode("");
    },
  });

  const enable = useApiMutation((c: string) => api.post<{ recoveryCodes: string[] }>("/auth/mfa/enable", { code: c }), {
    success: "Multi-factor authentication enabled",
    invalidate: [["users"]],
    onSuccess: (data) => {
      setSetup(null);
      setCode("");
      setRecoveryCodes(data?.recoveryCodes ?? []);
      void reload();
    },
  });

  const disable = useApiMutation((c: string) => api.post("/auth/mfa/disable", { code: c }), {
    success: "Multi-factor authentication disabled",
    invalidate: [["users"]],
    onSuccess: () => {
      setDisableOpen(false);
      setDisableCode("");
      void reload();
    },
  });

  const enabled = !!user?.mfaEnabled;

  return (
    <Card id="mfa" className={cn("scroll-mt-20", enrollRequired && !enabled && "border-sev-medium/50 ring-1 ring-sev-medium/30")}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" /> Multi-factor authentication
          </CardTitle>
          <CardDescription>Protect your account with a time-based one-time code from an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password…).</CardDescription>
        </div>
        {enabled ? (
          <Badge tone="success" className="shrink-0">
            <ShieldCheck /> Enabled
          </Badge>
        ) : (
          <Badge tone={enrollRequired ? "critical" : "medium"} className="shrink-0">
            <ShieldOff /> {enrollRequired ? "Required" : "Off"}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="grid gap-4">
        {recoveryCodes ? (
          <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
        ) : enabled ? (
          <p className="text-sm text-muted-foreground">
            A verification code from your authenticator app is required each time you sign in. If you lose your device, use one of your recovery codes
            or ask an administrator to reset MFA.
          </p>
        ) : setup ? (
          <form
            className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) enable.mutate(code);
            }}
          >
            <div className="grid justify-items-center gap-2">
              <div className="rounded-lg border bg-card p-2 shadow-xs">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL QR code generated by the API */}
                <img src={setup.qrCodeDataUrl} alt="QR code to add this account to your authenticator app" width={176} height={176} className="size-44" />
              </div>
              <a href={setup.otpauthUrl} className="text-xs text-primary hover:underline md:hidden">
                Open in authenticator app
              </a>
            </div>
            <div className="grid min-w-0 gap-3">
              <ol className="list-decimal space-y-1 pl-4 text-sm">
                <li>Scan the QR code with your authenticator app.</li>
                <li>Or enter the setup key manually.</li>
                <li>Enter the 6-digit code shown in the app to confirm.</li>
              </ol>
              <Field label="Setup key" htmlFor="mfa-secret">
                <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1">
                  <code id="mfa-secret" className="min-w-0 flex-1 break-all font-mono text-xs">
                    {setup.secret}
                  </code>
                  <CopyButton value={setup.secret} label="Copy setup key" />
                </div>
              </Field>
              <Field label="Verification code" htmlFor="mfa-code">
                <CodeInput id="mfa-code" value={code} onChange={setCode} autoFocus />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
                  Verify &amp; enable
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)} disabled={enable.isPending}>
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {enrollRequired
              ? "Your role requires MFA. Set it up now to continue using the console."
              : "MFA is not enabled. Enabling it greatly reduces the risk of account takeover from stolen passwords."}
          </p>
        )}
      </CardContent>

      {!recoveryCodes && !setup && (
        <CardFooter className="justify-end">
          {enabled ? (
            <Button variant="outline" onClick={() => setDisableOpen(true)}>
              <ShieldOff /> Disable MFA
            </Button>
          ) : (
            <Button onClick={() => start.mutate()} loading={start.isPending}>
              {!start.isPending && <ShieldCheck />} Set up MFA
            </Button>
          )}
        </CardFooter>
      )}

      <Dialog
        open={disableOpen}
        onOpenChange={(o) => {
          setDisableOpen(o);
          if (!o) setDisableCode("");
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Disable MFA?</DialogTitle>
            <DialogDescription>Enter a current code from your authenticator app (or a recovery code) to confirm.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (disableCode.length >= 6) disable.mutate(disableCode);
            }}
          >
            <Field label="Verification code" htmlFor="mfa-disable-code">
              <CodeInput id="mfa-disable-code" value={disableCode} onChange={setDisableCode} allowRecovery autoFocus />
            </Field>
            <p className="text-xs text-muted-foreground">Your account will be protected by password only. Roles that require MFA cannot disable it.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDisableOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={disable.isPending} disabled={disableCode.length < 6}>
                Disable MFA
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
