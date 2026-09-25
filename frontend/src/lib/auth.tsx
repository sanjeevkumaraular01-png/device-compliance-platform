"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authEvents, tokenStore } from "@/lib/api";
import type { CurrentUser, LoginResponse, TokenResponse } from "@/types/api";

const MFA_TOKEN_KEY = "sem.mfaToken";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export type LoginResult = { mfaRequired: true } | { mfaRequired: false; mfaEnrollmentRequired: boolean };

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  error: ApiError | null;
  permissions: Set<string>;
  mfaEnrollmentRequired: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  ldapLogin: (username: string, password: string) => Promise<LoginResult>;
  verifyMfa: (code: string) => Promise<LoginResult>;
  completeWithTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  setPendingMfaToken: (token: string) => void;
  hasPendingMfa: () => boolean;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (permission: string | string[], mode?: "any" | "all") => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function sessionGet(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function sessionSet(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = React.useState(false);

  const loadMe = React.useCallback(async () => {
    if (!tokenStore.hasSession()) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }
    setStatus((s) => (s === "authenticated" ? s : "loading"));
    try {
      const me = await api.get<CurrentUser>("/auth/me");
      setUser(me);
      setError(null);
      setStatus("authenticated");
      if (me.mfaEnabled) setMfaEnrollmentRequired(false);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, (e as Error)?.message ?? "Unknown error");
      if (err.status === 401) {
        tokenStore.clear();
        setUser(null);
        setStatus("unauthenticated");
      } else {
        setError(err);
        setStatus("error");
      }
    }
  }, []);

  React.useEffect(() => {
    void loadMe();
  }, [loadMe]);

  React.useEffect(() => {
    const offLogout = authEvents.on("logout", () => {
      tokenStore.clear();
      setUser(null);
      setStatus("unauthenticated");
      queryClient.clear();
    });
    const offMfa = authEvents.on("mfa-enrollment-required", () => {
      setMfaEnrollmentRequired(true);
    });
    return () => {
      offLogout();
      offMfa();
    };
  }, [queryClient]);

  // Tracks the X-MFA-Enrollment-Required header seen during the login request itself.
  const mfaEnrollmentFlag = React.useRef(false);
  React.useEffect(
    () =>
      authEvents.on("mfa-enrollment-required", () => {
        mfaEnrollmentFlag.current = true;
      }),
    [],
  );

  const acceptTokens = React.useCallback(
    (data: TokenResponse): LoginResult => {
      tokenStore.set(data);
      sessionSet(MFA_TOKEN_KEY, null);
      setUser(data.user);
      setError(null);
      setStatus("authenticated");
      queryClient.clear();
      const enrollment = !data.user.mfaEnabled && mfaEnrollmentFlag.current;
      mfaEnrollmentFlag.current = false;
      if (enrollment) setMfaEnrollmentRequired(true);
      return { mfaRequired: false, mfaEnrollmentRequired: enrollment };
    },
    [queryClient],
  );

  const handleLogin = React.useCallback(
    (res: LoginResponse): LoginResult => {
      if (res.mfaRequired) {
        sessionSet(MFA_TOKEN_KEY, res.mfaToken);
        return { mfaRequired: true };
      }
      return acceptTokens(res);
    },
    [acceptTokens],
  );

  const login = React.useCallback(
    async (email: string, password: string) => {
      mfaEnrollmentFlag.current = false;
      const res = await api.post<LoginResponse>("/auth/login", { email, password }, { anonymous: true });
      return handleLogin(res);
    },
    [handleLogin],
  );

  const ldapLogin = React.useCallback(
    async (username: string, password: string) => {
      mfaEnrollmentFlag.current = false;
      const res = await api.post<LoginResponse>("/auth/ldap/login", { username, password }, { anonymous: true });
      return handleLogin(res);
    },
    [handleLogin],
  );

  const verifyMfa = React.useCallback(
    async (code: string) => {
      const mfaToken = sessionGet(MFA_TOKEN_KEY);
      if (!mfaToken) throw new ApiError(401, "Your sign-in session expired. Please sign in again.");
      const res = await api.post<TokenResponse>("/auth/mfa/verify", { mfaToken, code }, { anonymous: true });
      return acceptTokens(res);
    },
    [acceptTokens],
  );

  const completeWithTokens = React.useCallback(
    async (accessToken: string, refreshToken: string) => {
      tokenStore.set({ accessToken, refreshToken });
      queryClient.clear();
      await loadMe();
    },
    [loadMe, queryClient],
  );

  const logout = React.useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken();
    if (refreshToken) {
      try {
        await api.post("/auth/logout", { refreshToken });
      } catch {
        /* best effort */
      }
    }
    tokenStore.clear();
    setUser(null);
    setStatus("unauthenticated");
    setMfaEnrollmentRequired(false);
    queryClient.clear();
    router.replace("/login");
  }, [queryClient, router]);

  const permissions = React.useMemo(() => new Set(user?.permissions ?? []), [user]);

  const can = React.useCallback(
    (permission: string | string[], mode: "any" | "all" = "any") => {
      const list = Array.isArray(permission) ? permission : [permission];
      if (list.length === 0) return true;
      return mode === "all" ? list.every((p) => permissions.has(p)) : list.some((p) => permissions.has(p));
    },
    [permissions],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      permissions,
      mfaEnrollmentRequired,
      login,
      ldapLogin,
      verifyMfa,
      completeWithTokens,
      setPendingMfaToken: (t: string) => sessionSet(MFA_TOKEN_KEY, t),
      hasPendingMfa: () => !!sessionGet(MFA_TOKEN_KEY),
      logout,
      reload: loadMe,
      can,
    }),
    [status, user, error, permissions, mfaEnrollmentRequired, login, ldapLogin, verifyMfa, completeWithTokens, logout, loadMe, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

/** True when the current user holds the permission (any of them, when an array is given). */
export function usePermission(permission: string | string[], mode: "any" | "all" = "any"): boolean {
  const { can } = useAuth();
  return can(permission, mode);
}

export function Can({
  permission,
  mode = "any",
  fallback = null,
  children,
}: {
  permission: string | string[];
  mode?: "any" | "all";
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const allowed = usePermission(permission, mode);
  return <>{allowed ? children : fallback}</>;
}

export function isEmployee(user: CurrentUser | null) {
  return user?.role === "EMPLOYEE";
}
