"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

function OtpInput({ value, onChange, disabled, onComplete }: { value: string; onChange: (v: string) => void; disabled?: boolean; onComplete?: (v: string) => void }) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  // Latest value, updated synchronously on every edit: fast typing / autofill fires
  // several change events before React re-renders, so the render-time `value` is stale.
  const latest = React.useRef(value);
  React.useEffect(() => {
    latest.current = value;
  }, [value]);
  // Empty boxes are stored as spaces so each digit keeps its position.
  const digits = Array.from({ length: 6 }, (_, i) => (value[i] ?? " ").trim());

  const commit = (next: string) => {
    latest.current = next;
    onChange(next);
    if (/^\d{6}$/.test(next)) onComplete?.(next);
  };

  const setAt = (i: number, d: string) => {
    const arr = latest.current.padEnd(6, " ").split("");
    arr[i] = d || " ";
    commit(arr.join("").trimEnd());
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit authentication code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          aria-label={`Digit ${i + 1}`}
          disabled={disabled}
          value={d}
          autoFocus={i === 0}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (!v) {
              setAt(i, "");
              return;
            }
            const old = (latest.current[i] ?? "").trim();
            if (v.length === 2 && old && v.includes(old)) {
              // typed over an existing digit: keep only the new one
              setAt(i, v.replace(old, "") || old);
              if (i < 5) refs.current[i + 1]?.focus();
              return;
            }
            if (v.length > 1) {
              // pasted / autofilled / inserted multiple digits
              const merged = (latest.current.padEnd(6, " ").slice(0, i) + v).slice(0, 6);
              commit(merged);
              refs.current[Math.min(merged.length, 5)]?.focus();
              return;
            }
            setAt(i, v);
            if (i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (text) {
              e.preventDefault();
              commit(text);
              refs.current[Math.min(text.length, 5)]?.focus();
            }
          }}
          className={cn(
            "h-12 w-full min-w-0 rounded-md border border-input bg-card text-center font-mono text-lg font-semibold shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
          )}
        />
      ))}
    </div>
  );
}

function MfaInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const { verifyMfa, hasPendingMfa, status } = useAuth();
  const [mode, setMode] = React.useState<"totp" | "recovery">("totp");
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState("");
  const [error, setError] = React.useState<unknown>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (status === "authenticated") {
      router.replace(next);
      return;
    }
    if (!hasPendingMfa()) router.replace("/login");
    else setReady(true);
  }, [hasPendingMfa, router, status, next]);

  const submit = async (value: string) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await verifyMfa(value.trim());
      if (!res.mfaRequired && res.mfaEnrollmentRequired) router.replace("/settings?tab=security&enroll=1");
      else router.replace(next);
    } catch (e) {
      setError(e);
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="mb-4 grid size-11 place-items-center rounded-lg border bg-card text-primary">
          {mode === "totp" ? <ShieldCheck className="size-5" /> : <KeyRound className="size-5" />}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "totp"
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of the recovery codes you saved when enabling MFA. Each code can be used once."}
        </p>
      </div>

      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(mode === "totp" ? code : recovery);
        }}
      >
        {mode === "totp" ? (
          <OtpInput value={code} onChange={setCode} disabled={submitting} onComplete={(v) => void submit(v)} />
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="recovery">Recovery code</Label>
            <Input
              id="recovery"
              autoFocus
              autoComplete="off"
              placeholder="xxxxx-xxxxx"
              className="font-mono"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
            />
          </div>
        )}
        {!!error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{errorMessage(error, "Verification failed")}</span>
          </div>
        )}
        <Button
          type="submit"
          className="w-full"
          loading={submitting}
          disabled={mode === "totp" ? !/^\d{6}$/.test(code) : recovery.trim().length < 6}
        >
          Verify
        </Button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-2 text-xs">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            setMode((m) => (m === "totp" ? "recovery" : "totp"));
            setError(null);
          }}
        >
          {mode === "totp" ? "Use a recovery code instead" : "Use authenticator app code"}
        </button>
        <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense fallback={null}>
      <MfaInner />
    </Suspense>
  );
}
