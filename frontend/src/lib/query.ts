import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Client errors are final; an unreachable API fails fast so the error state (with Retry) shows at once.
          if (error instanceof ApiError && ((error.status >= 400 && error.status < 500) || error.isNetwork)) return false;
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** Centralised query keys so invalidation stays consistent across pages. */
export const qk = {
  me: ["auth", "me"] as const,
  sessions: ["auth", "sessions"] as const,
  ssoProviders: ["auth", "sso-providers"] as const,
  dashboard: (part: string, params?: unknown) => ["dashboard", part, params] as const,
  devices: (params?: unknown) => ["devices", "list", params] as const,
  device: (id: string) => ["devices", "detail", id] as const,
  deviceSub: (id: string, sub: string, params?: unknown) => ["devices", "detail", id, sub, params] as const,
  list: (resource: string, params?: unknown) => [resource, "list", params] as const,
  one: (resource: string, id: string) => [resource, "detail", id] as const,
  resource: (resource: string, ...rest: unknown[]) => [resource, ...rest] as const,
};
