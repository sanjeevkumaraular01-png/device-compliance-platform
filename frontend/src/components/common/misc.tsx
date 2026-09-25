"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { cn, copyToClipboard } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/format";

export function CopyButton({ value, label = "Copy", className, size = "icon-xs" }: { value: string; label?: string; className?: string; size?: "icon-xs" | "icon-sm" | "sm" }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await copyToClipboard(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };
  if (size === "sm") {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onCopy} className={className}>
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : label}
      </Button>
    );
  }
  return (
    <SimpleTooltip label={copied ? "Copied" : label}>
      <Button type="button" variant="ghost" size={size} onClick={onCopy} className={className} aria-label={label}>
        {copied ? <Check className="text-sev-none" /> : <Copy />}
      </Button>
    </SimpleTooltip>
  );
}

export function OnlineDot({ online, className, withLabel }: { online: boolean; className?: string; withLabel?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative flex size-2">
        {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-sev-none opacity-50" />}
        <span className={cn("relative inline-flex size-2 rounded-full", online ? "bg-sev-none" : "bg-sev-unknown/60")} />
      </span>
      {withLabel ? <span className="text-xs">{online ? "Online" : "Offline"}</span> : <span className="sr-only">{online ? "Online" : "Offline"}</span>}
    </span>
  );
}

export function RelativeTime({ value, fallback = "Never", className }: { value: string | null | undefined; fallback?: string; className?: string }) {
  // Re-render every minute so "x minutes ago" stays fresh.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!value) return <span className={cn("text-muted-foreground", className)}>{fallback}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} className={cn("whitespace-nowrap", className)}>
      {formatRelative(value, fallback)}
    </time>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Label/value grid for inventory-like detail panels. */
export function KeyValueGrid({ items, className, cols = 2 }: { items: { label: string; value: React.ReactNode; mono?: boolean }[]; className?: string; cols?: 2 | 3 | 4 }) {
  const colCls = cols === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", colCls, className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{it.label}</dt>
          <dd className={cn("mt-0.5 truncate text-sm", it.mono && "font-mono text-xs")}>
            {it.value === null || it.value === undefined || it.value === "" ? <span className="text-muted-foreground">—</span> : it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs", className)}>{children}</span>;
}
