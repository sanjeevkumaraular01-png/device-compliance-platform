"use client";

import * as React from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PageMeta, Paginated } from "@/types/api";
import { useDebounce } from "@/hooks/use-debounce";

export type FilterValue = string | number | boolean | undefined;

export interface ListState {
  page: number;
  pageSize: number;
  search: string;
  sortBy?: string;
  sortOrder: "asc" | "desc";
  filters: Record<string, FilterValue>;
}

/** Accepts either the documented `{data, meta}` envelope or a bare array and returns an envelope. */
export function normalizeList<T>(res: Paginated<T> | T[] | null | undefined): Paginated<T> {
  if (!res) return { data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 1 } };
  if (Array.isArray(res)) {
    return { data: res, meta: { page: 1, pageSize: res.length, total: res.length, totalPages: 1 } };
  }
  const meta: PageMeta = res.meta ?? { page: 1, pageSize: res.data?.length ?? 0, total: res.data?.length ?? 0, totalPages: 1 };
  return { data: res.data ?? [], meta };
}

export interface UseListQueryOptions {
  initial?: Partial<Omit<ListState, "filters">> & { filters?: Record<string, FilterValue> };
  /** Extra params always sent (not user-editable). */
  fixedParams?: Record<string, FilterValue>;
  enabled?: boolean;
  /** Fixed interval, or a function of the current page data (e.g. poll while jobs are running). */
  refetchInterval?: number | false | ((data: Paginated<unknown> | undefined) => number | false);
}

export interface UseListQueryResult<T> {
  state: ListState;
  params: Record<string, FilterValue>;
  query: UseQueryResult<Paginated<T>>;
  rows: T[];
  meta: PageMeta | undefined;
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  setSearch: (s: string) => void;
  setSort: (sortBy: string | undefined, sortOrder?: "asc" | "desc") => void;
  setFilter: (key: string, value: FilterValue) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

/**
 * Server-side paginated list with search (debounced), sort and filters.
 * `queryKey` should be a stable resource name, e.g. "devices".
 */
export function useListQuery<T>(queryKey: string | readonly unknown[], path: string, options: UseListQueryOptions = {}): UseListQueryResult<T> {
  const { initial, fixedParams, enabled = true, refetchInterval } = options;
  const [state, setState] = React.useState<ListState>(() => ({
    page: initial?.page ?? 1,
    pageSize: initial?.pageSize ?? 25,
    search: initial?.search ?? "",
    sortBy: initial?.sortBy,
    sortOrder: initial?.sortOrder ?? "desc",
    filters: initial?.filters ?? {},
  }));
  const debouncedSearch = useDebounce(state.search, 300);

  const params = React.useMemo(() => {
    const p: Record<string, FilterValue> = {
      page: state.page,
      pageSize: state.pageSize,
      search: debouncedSearch || undefined,
      sortBy: state.sortBy,
      sortOrder: state.sortBy ? state.sortOrder : undefined,
      ...fixedParams,
    };
    for (const [k, v] of Object.entries(state.filters)) {
      if (v !== undefined && v !== "" && v !== "all") p[k] = v;
    }
    return p;
  }, [state, debouncedSearch, fixedParams]);

  const baseKey = typeof queryKey === "string" ? [queryKey] : [...queryKey];

  const query = useQuery<Paginated<T>>({
    queryKey: [...baseKey, "list", path, params],
    queryFn: async ({ signal }) => normalizeList(await api.get<Paginated<T> | T[]>(path, params, { signal })),
    placeholderData: keepPreviousData,
    enabled,
    // React Query v5 passes the Query object; callers get the page data.
    refetchInterval: typeof refetchInterval === "function" ? (q) => refetchInterval(q.state.data) : refetchInterval,
  });

  const setPage = React.useCallback((page: number) => setState((s) => ({ ...s, page })), []);
  const setPageSize = React.useCallback((pageSize: number) => setState((s) => ({ ...s, pageSize, page: 1 })), []);
  const setSearch = React.useCallback((search: string) => setState((s) => ({ ...s, search, page: 1 })), []);
  const setSort = React.useCallback(
    (sortBy: string | undefined, sortOrder: "asc" | "desc" = "desc") => setState((s) => ({ ...s, sortBy, sortOrder, page: 1 })),
    [],
  );
  const setFilter = React.useCallback(
    (key: string, value: FilterValue) => setState((s) => ({ ...s, page: 1, filters: { ...s.filters, [key]: value } })),
    [],
  );
  const clearFilters = React.useCallback(() => setState((s) => ({ ...s, page: 1, search: "", filters: {} })), []);

  const activeFilterCount = Object.values(state.filters).filter((v) => v !== undefined && v !== "" && v !== "all").length;

  return {
    state,
    params,
    query,
    rows: query.data?.data ?? [],
    meta: query.data?.meta,
    setPage,
    setPageSize,
    setSearch,
    setSort,
    setFilter,
    clearFilters,
    activeFilterCount,
  };
}
