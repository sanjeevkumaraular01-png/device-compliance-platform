"use client";

import type { ApiErrorBody, ListParams, TokenResponse } from "@/types/api";
import { saveBlob } from "@/lib/utils";

export const API_BASE = "/api/v1";

const ACCESS_KEY = "sem.accessToken";
const REFRESH_KEY = "sem.refreshToken";

// ─────────────────────────────── Token storage ───────────────────────────────
// Access token: kept in memory, mirrored to sessionStorage so a page reload in the same tab
// does not force a refresh round-trip. Refresh token: localStorage (survives tab close).

let accessTokenMem: string | null = null;

function safeStorage(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export const tokenStore = {
  getAccessToken(): string | null {
    if (accessTokenMem) return accessTokenMem;
    const v = safeStorage("session")?.getItem(ACCESS_KEY) ?? null;
    accessTokenMem = v;
    return v;
  },
  getRefreshToken(): string | null {
    return safeStorage("local")?.getItem(REFRESH_KEY) ?? null;
  },
  set(tokens: { accessToken: string; refreshToken: string }) {
    accessTokenMem = tokens.accessToken;
    safeStorage("session")?.setItem(ACCESS_KEY, tokens.accessToken);
    safeStorage("local")?.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    accessTokenMem = null;
    safeStorage("session")?.removeItem(ACCESS_KEY);
    safeStorage("local")?.removeItem(REFRESH_KEY);
  },
  hasSession(): boolean {
    return !!(this.getAccessToken() || this.getRefreshToken());
  },
};

// ─────────────────────────────── Events ───────────────────────────────

export type AuthEventType = "logout" | "mfa-enrollment-required" | "tokens";
const bus: EventTarget | null = typeof window !== "undefined" ? new EventTarget() : null;

export const authEvents = {
  emit(type: AuthEventType) {
    bus?.dispatchEvent(new Event(type));
  },
  on(type: AuthEventType, fn: () => void) {
    bus?.addEventListener(type, fn);
    return () => bus?.removeEventListener(type, fn);
  },
};

// ─────────────────────────────── Errors ───────────────────────────────

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | null;
  requestId?: string;

  constructor(status: number, message: string, body: ApiErrorBody | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.requestId = body?.requestId;
  }

  get isNetwork() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isNotFound() {
    return this.status === 404;
  }
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
  }
  let message: string;
  if (body?.message) {
    message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
  } else if (res.status >= 500 && !body) {
    // The Next.js rewrite / Nginx returns a non-JSON 5xx when the backend is down.
    return new ApiError(503, "The SecureEndpoint API is unreachable. Check that the backend service is running.");
  } else if (res.status === 429) {
    message = "Too many requests — please slow down and try again shortly.";
  } else {
    message = res.statusText || `Request failed with status ${res.status}`;
  }
  return new ApiError(res.status, message, body);
}

// ─────────────────────────────── Refresh (single-flight) ───────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

export function refreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) return Promise.resolve(false);
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // Only a definitive auth rejection kills the session; transient errors keep tokens.
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          tokenStore.clear();
          authEvents.emit("logout");
        }
        return false;
      }
      const data = (await res.json()) as TokenResponse;
      tokenStore.set(data);
      authEvents.emit("tokens");
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();
  return refreshPromise;
}

// ─────────────────────────────── Request core ───────────────────────────────

type Query = ListParams | Record<string, string | number | boolean | undefined | null | string[]>;

export function buildQuery(params?: Query): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  params?: Query;
  /** Do not attach the bearer token / do not try refresh (auth endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const AUTH_PATHS_NO_REFRESH = ["/auth/login", "/auth/ldap/login", "/auth/mfa/verify", "/auth/refresh", "/auth/sso/providers"];

async function rawRequest(path: string, opts: RequestOptions, retried = false): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const token = opts.anonymous ? null : tokenStore.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.params)}`, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError(0, "Unable to reach the SecureEndpoint API. Check your network connection or the backend status.");
  }

  if (res.headers.get("X-MFA-Enrollment-Required") === "true") {
    authEvents.emit("mfa-enrollment-required");
  }

  const skipRefresh = opts.anonymous || AUTH_PATHS_NO_REFRESH.some((p) => path.startsWith(p));
  if (res.status === 401 && !skipRefresh && !retried) {
    const ok = await refreshTokens();
    if (ok) return rawRequest(path, opts, true);
    if (!tokenStore.getRefreshToken()) authEvents.emit("logout");
  }
  return res;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(path, opts);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  const text = await res.text();
  return (text ? (text as unknown) : undefined) as T;
}

export const api = {
  get: <T>(path: string, params?: Query, opts?: Omit<RequestOptions, "params" | "method">) =>
    request<T>(path, { ...opts, params, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...opts, body: body ?? {}, method: "POST" }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...opts, body: body ?? {}, method: "PATCH" }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...opts, body: body ?? {}, method: "PUT" }),
  delete: <T = void>(path: string, params?: Query, opts?: Omit<RequestOptions, "params" | "method">) =>
    request<T>(path, { ...opts, params, method: "DELETE" }),
};

/** Downloads a file stream with the auth header and saves it via a blob URL. */
export async function downloadFile(path: string, fallbackName: string, params?: Query): Promise<void> {
  const res = await rawRequest(path, { method: "GET", params, headers: { Accept: "*/*" } });
  if (!res.ok) throw await parseError(res);
  const cd = res.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  const name = match ? decodeURIComponent(match[1] ?? match[2]) : fallbackName;
  const blob = await res.blob();
  saveBlob(blob, name);
}

/** Fetches a binary resource with the auth header (e.g. screenshot images). Caller owns the blob. */
export async function fetchBlob(path: string, params?: Query, signal?: AbortSignal): Promise<Blob> {
  const res = await rawRequest(path, { method: "GET", params, signal, headers: { Accept: "image/*,*/*" } });
  if (!res.ok) throw await parseError(res);
  return res.blob();
}
