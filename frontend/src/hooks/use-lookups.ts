"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { normalizeList } from "@/hooks/use-list-query";
import type { Department, DevicePolicy, Paginated, Role, User, Device, WorkProfile } from "@/types/api";

/** Reference data used by selects and filters across pages (cached 5 min). */

export function useDepartments(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["departments", "lookup"],
    queryFn: async () => normalizeList(await api.get<Paginated<Department> | Department[]>("/departments", { pageSize: 200, sortBy: "name", sortOrder: "asc" })).data,
    staleTime: 5 * 60_000,
    enabled: enabled && can(["users:read", "devices:read"]),
  });
}

export function usePolicies(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["policies", "lookup"],
    queryFn: async () => normalizeList(await api.get<Paginated<DevicePolicy> | DevicePolicy[]>("/policies", { pageSize: 200 })).data,
    staleTime: 5 * 60_000,
    enabled: enabled && can("policies:read"),
  });
}

export function useWorkProfiles(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["work-profiles", "lookup"],
    queryFn: async () =>
      normalizeList(await api.get<Paginated<WorkProfile> | WorkProfile[]>("/work-profiles", { pageSize: 200, sortBy: "name", sortOrder: "asc" })).data,
    staleTime: 5 * 60_000,
    enabled: enabled && can("policies:read"),
  });
}

export function useRoles(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["roles", "lookup"],
    queryFn: async () => normalizeList(await api.get<Paginated<Role> | Role[]>("/roles")).data,
    staleTime: 5 * 60_000,
    enabled: enabled && can("users:read"),
  });
}

/** Searchable user lookup (for assignment pickers). */
export function useUserSearch(search: string, enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["users", "lookup", search],
    queryFn: async () =>
      normalizeList(await api.get<Paginated<User> | User[]>("/users", { pageSize: 20, search: search || undefined, isActive: true })).data,
    staleTime: 60_000,
    enabled: enabled && can("users:read"),
  });
}

/** Searchable device lookup (for pickers, e.g. USB access requests). */
export function useDeviceSearch(search: string, enabled = true) {
  return useQuery({
    queryKey: ["devices", "lookup", search],
    queryFn: async () => normalizeList(await api.get<Paginated<Device> | Device[]>("/devices", { pageSize: 20, search: search || undefined })).data,
    staleTime: 60_000,
    enabled,
  });
}
