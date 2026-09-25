"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { normalizeList } from "@/hooks/use-list-query";
import type { Alert, ComplianceTrendPoint, DashboardSummary, DepartmentCompliance, Paginated, TopViolation } from "@/types/api";

export const DASHBOARD_REFRESH_MS = 60_000;

/** Same key + fetcher as the topbar so the cache is shared. */
export const SUMMARY_QUERY_KEY = ["dashboard", "summary", undefined] as const;

export function useDashboardSummary(enabled = true) {
  return useQuery({
    queryKey: SUMMARY_QUERY_KEY,
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    refetchInterval: DASHBOARD_REFRESH_MS,
    enabled,
  });
}

async function getArray<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T[]> {
  return normalizeList(await api.get<T[] | Paginated<T>>(path, params)).data;
}

export function useComplianceTrend(days: number) {
  return useQuery({
    queryKey: ["dashboard", "compliance-trend", days],
    queryFn: () => getArray<ComplianceTrendPoint>("/dashboard/compliance-trend", { days }),
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useTopViolations(limit = 5) {
  return useQuery({
    queryKey: ["dashboard", "top-violations", limit],
    queryFn: () => getArray<TopViolation>("/dashboard/top-violations", { limit }),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useDepartmentCompliance() {
  return useQuery({
    queryKey: ["dashboard", "department-compliance"],
    queryFn: () => getArray<DepartmentCompliance>("/dashboard/department-compliance"),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useRecentAlerts(limit = 10) {
  return useQuery({
    queryKey: ["dashboard", "recent-alerts", limit],
    queryFn: () => getArray<Alert>("/dashboard/recent-alerts", { limit }),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}
