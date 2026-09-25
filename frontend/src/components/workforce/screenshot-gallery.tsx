"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, EyeOff, ImageOff, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { normalizeList } from "@/hooks/use-list-query";
import { api, fetchBlob } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/components/workforce/common";
import type { Paginated, Screenshot } from "@/types/api";

/**
 * Image fetched with the bearer token and shown through a blob: URL.
 * Loads lazily when scrolled into view; the object URL is revoked on unmount / change.
 */
export function AuthImage({
  path,
  alt,
  className,
  eager = false,
}: {
  path: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(eager);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (visible || !ref.current) return;
    const el = ref.current;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    setFailed(false);
    setUrl(null);
    fetchBlob(path, undefined, ctrl.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name !== "AbortError") setFailed(true);
      });
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, path]);

  return (
    <div ref={ref} className={cn("relative grid place-items-center overflow-hidden bg-muted", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from an authenticated fetch
        <img src={url} alt={alt} className="size-full object-cover" draggable={false} />
      ) : failed ? (
        <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
          <ImageOff className="size-4" /> Unavailable
        </span>
      ) : visible ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading image" />
      ) : null}
    </div>
  );
}

export function ScreenshotAuditNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
      <ShieldCheck className="mt-px size-3.5 shrink-0" />
      Every screenshot view and download is recorded in the audit log (workforce.screenshot.view). Images are encrypted at rest and deleted
      automatically after the policy&apos;s retention period.
    </p>
  );
}

/** Thumbnail grid + lightbox for one employee and date. */
export function ScreenshotGallery({
  userId,
  date,
  canDelete,
  variant = "grid",
  emptyDescription,
}: {
  userId: string;
  date: string;
  canDelete?: boolean;
  /** Overrides the empty-state explanation (e.g. why screenshots may be missing). */
  emptyDescription?: React.ReactNode;
  /** "strip" = one horizontally scrolling row. */
  variant?: "grid" | "strip";
}) {
  const q = useQuery({
    queryKey: ["workforce", "screenshots", userId, date],
    queryFn: async () => normalizeList(await api.get<Screenshot[] | Paginated<Screenshot>>("/workforce/screenshots", { userId, date })).data,
    enabled: !!userId,
  });
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const confirm = useConfirm();
  const del = useApiMutation((id: string) => api.delete(`/workforce/screenshots/${id}`), {
    success: "Screenshot deleted",
    invalidate: [["workforce", "screenshots"], ["workforce", "day"]],
    onSuccess: () => setOpenIdx(null),
  });

  const items = q.data ?? [];
  const current = openIdx !== null ? items[openIdx] : undefined;

  const onDelete = async (s: Screenshot) => {
    const ok = await confirm({
      title: "Delete this screenshot?",
      description: `Captured ${formatDateTime(s.capturedAt)}. The encrypted image is removed permanently.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) del.mutate(s.id);
  };

  if (q.isLoading) {
    return (
      <div className={variant === "strip" ? "flex gap-2 overflow-hidden" : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"}>
        {Array.from({ length: variant === "strip" ? 4 : 8 }).map((_, i) => (
          <Skeleton key={i} className={cn("aspect-video", variant === "strip" && "w-44 shrink-0")} />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => q.refetch()} />;
  if (items.length === 0) {
    return <EmptyState compact icon={ImageOff} title="No screenshots" description={emptyDescription ?? "No screenshots were captured for this day."} />;
  }

  return (
    <>
      <ul className={variant === "strip" ? "flex gap-2 overflow-x-auto pb-1 scrollbar-thin" : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"}>
        {items.map((s, i) => (
          <li key={s.id} className={cn(variant === "strip" && "w-44 shrink-0")}>
            <button
              type="button"
              onClick={() => setOpenIdx(i)}
              aria-label={`Open screenshot captured at ${fmtTime(s.capturedAt)}${s.activeApp ? ` in ${s.activeApp}` : ""}`}
              className="group block w-full overflow-hidden rounded-md border bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative">
                <AuthImage path={`/workforce/screenshots/${s.id}/image`} alt={`Screenshot at ${fmtTime(s.capturedAt)}`} className="aspect-video w-full" />
                {s.blurred && (
                  <Badge tone="neutral" className="absolute left-1.5 top-1.5 bg-background/85 backdrop-blur">
                    <EyeOff /> Blurred
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
                <span className="font-medium tabular">{fmtTime(s.capturedAt)}</span>
                <span className="truncate text-muted-foreground">{s.activeApp ?? "—"}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={openIdx !== null} onOpenChange={(o) => !o && setOpenIdx(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Screenshot · {current ? formatDateTime(current.capturedAt) : ""}
              {current?.blurred && (
                <Badge tone="neutral">
                  <EyeOff /> Blurred on device
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {current?.activeApp ? `Active app: ${current.activeApp}` : "Active app unknown"}
              {current?.taskTitle ? ` · Task: ${current.taskTitle}` : ""}
            </DialogDescription>
          </DialogHeader>
          {current && (
            <AuthImage
              key={current.id}
              eager
              path={`/workforce/screenshots/${current.id}/image`}
              alt={`Screenshot captured ${formatDateTime(current.capturedAt)}`}
              className="max-h-[70dvh] w-full rounded-md border [&_img]:object-contain"
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous screenshot" disabled={!openIdx} onClick={() => setOpenIdx((i) => (i ? i - 1 : i))}>
                <ChevronLeft />
              </Button>
              <span className="px-2 text-xs text-muted-foreground tabular">
                {(openIdx ?? 0) + 1} / {items.length}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next screenshot"
                disabled={openIdx === null || openIdx >= items.length - 1}
                onClick={() => setOpenIdx((i) => (i !== null && i < items.length - 1 ? i + 1 : i))}
              >
                <ChevronRight />
              </Button>
            </div>
            {canDelete && current && (
              <Button variant="destructive" size="sm" onClick={() => void onDelete(current)} loading={del.isPending}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
          <ScreenshotAuditNote />
        </DialogContent>
      </Dialog>
    </>
  );
}
