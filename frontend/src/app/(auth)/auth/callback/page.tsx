"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";

/**
 * SSO landing page. The backend redirects here with tokens in the URL fragment:
 *   /auth/callback#accessToken=..&refreshToken=..   or   /auth/callback#mfaToken=..
 * Errors may arrive as #error=..&error_description=.. (or ?error=..).
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { completeWithTokens, setPendingMfaToken } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    // Remove tokens from the address bar / history immediately.
    window.history.replaceState(null, "", window.location.pathname);

    const err = hash.get("error") ?? query.get("error");
    if (err) {
      setError(hash.get("error_description") ?? query.get("error_description") ?? err);
      return;
    }
    const mfaToken = hash.get("mfaToken");
    if (mfaToken) {
      setPendingMfaToken(mfaToken);
      router.replace("/login/mfa");
      return;
    }
    const accessToken = hash.get("accessToken");
    const refreshToken = hash.get("refreshToken");
    if (accessToken && refreshToken) {
      completeWithTokens(accessToken, refreshToken)
        .then(() => router.replace("/dashboard"))
        .catch((e) => setError(errorMessage(e, "Could not complete single sign-on")));
      return;
    }
    setError("The sign-in response did not contain any credentials.");
  }, [completeWithTokens, setPendingMfaToken, router]);

  if (error) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-5" />
        </div>
        <h1 className="text-lg font-semibold">Single sign-on failed</h1>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button asChild className="mt-5">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      Completing sign-in…
    </div>
  );
}
