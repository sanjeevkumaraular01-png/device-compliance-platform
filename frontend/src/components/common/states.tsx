"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Inbox, Lock, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-1.5 py-6" : "gap-2 py-12", className)}>
      <div className={cn("grid place-items-center rounded-full bg-muted text-muted-foreground", compact ? "size-9" : "size-12")}>
        <Icon className={compact ? "size-4" : "size-5"} />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const isNetwork = error instanceof ApiError && error.isNetwork;
  const isForbidden = error instanceof ApiError && error.isForbidden;
  if (isForbidden) return <Forbidden compact={compact} className={className} message={errorMessage(error)} />;
  const Icon = isNetwork ? WifiOff : AlertCircle;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "py-6" : "py-12", className)}>
      <div className={cn("grid place-items-center rounded-full bg-destructive/10 text-destructive", compact ? "size-9" : "size-12")}>
        <Icon className={compact ? "size-4" : "size-5"} />
      </div>
      <p className="text-sm font-medium">{title ?? (isNetwork ? "Service unavailable" : "Failed to load data")}</p>
      <p className="max-w-md text-xs text-muted-foreground">{errorMessage(error)}</p>
      {error instanceof ApiError && error.requestId && (
        <p className="font-mono text-[10px] text-muted-foreground/70">Request ID: {error.requestId}</p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function Forbidden({ message, compact, className }: { message?: string; compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "py-6" : "py-20", className)}>
      <div className="grid size-14 place-items-center rounded-full bg-sev-medium/12 text-sev-medium">
        <Lock className="size-6" />
      </div>
      <p className="text-base font-semibold">Access restricted</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {message && message !== "Forbidden resource"
          ? message
          : "Your role does not include permission to view this area. Contact a SecureEndpoint administrator if you believe this is a mistake."}
      </p>
      {!compact && (
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className={cn("h-3.5", j === 0 ? "w-40" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-2 h-7 w-16" />
      <Skeleton className="h-2.5 w-32" />
    </div>
  );
}

/** Renders children when data is ready; handles loading & error uniformly. */
export function QueryBoundary<T>({
  query,
  loading,
  empty,
  isEmpty,
  children,
  compact,
}: {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
  compact?: boolean;
}) {
  if (query.isLoading) return <>{loading ?? <TableSkeleton rows={4} />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} compact={compact} />;
  if (query.data === undefined) return <>{loading ?? <TableSkeleton rows={4} />}</>;
  if (isEmpty && isEmpty(query.data)) return <>{empty ?? <EmptyState title="Nothing here yet" compact={compact} />}</>;
  return <>{children(query.data)}</>;
}
