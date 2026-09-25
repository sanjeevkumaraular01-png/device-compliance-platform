"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { normalizeList } from "@/hooks/use-list-query";
import type { Device, EnrollmentToken, OsPlatform, Paginated } from "@/types/api";

export function useEnrollmentTokens(enabled = true) {
  return useQuery({
    queryKey: ["enrollment", "tokens"],
    queryFn: async ({ signal }) =>
      normalizeList(await api.get<Paginated<EnrollmentToken> | EnrollmentToken[]>("/enrollment/tokens", { pageSize: 200 }, { signal })).data,
    enabled,
  });
}

export function usePendingDevices(enabled = true) {
  return useQuery({
    queryKey: ["enrollment", "pending"],
    queryFn: async ({ signal }) => normalizeList(await api.get<Paginated<Device> | Device[]>("/enrollment/pending", { pageSize: 200 }, { signal })).data,
    refetchInterval: 30_000,
    enabled,
  });
}

export type TokenState = "active" | "revoked" | "expired" | "exhausted";

export function tokenState(t: EnrollmentToken, now = Date.now()): TokenState {
  if (t.revokedAt) return "revoked";
  if (new Date(t.expiresAt).getTime() <= now) return "expired";
  if (t.maxUses > 0 && t.usedCount >= t.maxUses) return "exhausted";
  return "active";
}

export const SHELL_BY_PLATFORM: Record<OsPlatform, { shell: string; hint: string }> = {
  WINDOWS: { shell: "PowerShell", hint: "Run in an elevated PowerShell session (Run as administrator)." },
  LINUX: { shell: "bash", hint: "Run as root or with sudo on the target host." },
  MACOS: { shell: "zsh", hint: "Run in Terminal with an administrator account (sudo)." },
};

export const CA_CERT_PATH = "/api/v1/enrollment/ca.pem";
