"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";

export interface ApiMutationOptions<TData, TVars> {
  /** Toast message on success (string or builder). Pass `false` to disable. */
  success?: string | false | ((data: TData, vars: TVars) => string);
  /** Toast title prefix on error. */
  errorTitle?: string;
  /** Query key prefixes to invalidate on success. */
  invalidate?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: unknown, vars: TVars) => void;
}

/** useMutation + toast feedback + cache invalidation. */
export function useApiMutation<TVars = void, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  options: ApiMutationOptions<TData, TVars> = {},
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      if (options.success !== false && options.success !== undefined) {
        toast.success(typeof options.success === "function" ? options.success(data, vars) : options.success);
      }
      options.onSuccess?.(data, vars);
      if (options.invalidate?.length) {
        await Promise.all(options.invalidate.map((key) => qc.invalidateQueries({ queryKey: key })));
      }
    },
    onError: (err, vars) => {
      toast.error(options.errorTitle ?? "Action failed", { description: errorMessage(err) });
      options.onError?.(err, vars);
    },
  });
}
