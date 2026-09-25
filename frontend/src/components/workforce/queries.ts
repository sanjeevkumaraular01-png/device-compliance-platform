"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { normalizeList } from "@/hooks/use-list-query";
import type {
  AiInsight,
  AiStatus,
  EmployeeDay,
  LiveEmployee,
  Paginated,
  Project,
  WorkTask,
  WorkforceMe,
  WorkforcePolicy,
  WorkforceSummary,
} from "@/types/api";

/** Query-key roots. Invalidate `["workforce"]` after clock / timer / attendance changes. */
export const WF_KEYS = {
  me: ["workforce", "me"] as const,
  summary: (p?: unknown) => ["workforce", "summary", p] as const,
  live: (p?: unknown) => ["workforce", "live", p] as const,
  day: (userId: string, date: string) => ["workforce", "day", userId, date] as const,
};

export const LIVE_REFRESH_MS = 30_000;

async function getArray<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T[]> {
  return normalizeList(await api.get<T[] | Paginated<T>>(path, params)).data;
}

/** `GET /workforce/me` — own policy, today's session, live status and running timer. Shared by My Day, Tasks and the top bar. */
export function useWorkforceMe(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: WF_KEYS.me,
    queryFn: () => api.get<WorkforceMe>("/workforce/me"),
    enabled: enabled && can("workforce:self"),
    refetchInterval: 60_000,
  });
}

export function useWorkforceSummary(params: { date?: string; departmentId?: string }, enabled = true) {
  return useQuery({
    queryKey: WF_KEYS.summary(params),
    queryFn: () => api.get<WorkforceSummary>("/workforce/summary", params),
    enabled,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useWorkforceLive(params: { departmentId?: string; status?: string; search?: string }, enabled = true) {
  return useQuery({
    queryKey: WF_KEYS.live(params),
    queryFn: () => getArray<LiveEmployee>("/workforce/live", params),
    enabled,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useEmployeeDay(userId: string | undefined, date: string) {
  return useQuery({
    queryKey: WF_KEYS.day(userId ?? "", date),
    queryFn: () => api.get<EmployeeDay>(`/workforce/users/${userId}/day`, { date }),
    enabled: !!userId,
    placeholderData: keepPreviousData,
  });
}

/** Own open tasks (for timers, pickers and the report editor). */
export function useMyTasks(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["tasks", "mine", "lookup"],
    queryFn: () => getArray<WorkTask>("/tasks", { mine: true, pageSize: 200, sortBy: "updatedAt", sortOrder: "desc" }),
    enabled: enabled && can("workforce:self"),
    staleTime: 30_000,
  });
}

export function useProjects(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["projects", "lookup"],
    queryFn: () => getArray<Project>("/projects", { pageSize: 200, sortBy: "name", sortOrder: "asc" }),
    enabled: enabled && can(["workforce:self", "tasks:manage", "workforce:read"]),
    staleTime: 60_000,
  });
}

export function useWorkforcePolicies(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["workforce", "policies", "lookup"],
    queryFn: () => getArray<WorkforcePolicy>("/workforce/policies", { pageSize: 200 }),
    enabled: enabled && can("workforce:manage"),
    staleTime: 60_000,
  });
}

export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: ["ai", "status"],
    queryFn: () => api.get<AiStatus>("/ai/status"),
    enabled,
    staleTime: 60_000,
  });
}

export function useAiInsights(params: { date?: string; type?: string; userId?: string; departmentId?: string }, enabled = true) {
  return useQuery({
    queryKey: ["ai", "insights", params],
    queryFn: () => getArray<AiInsight>("/ai/insights", params),
    enabled,
    placeholderData: keepPreviousData,
  });
}
