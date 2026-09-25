import { useId } from "react";
import { cn } from "@/lib/utils";

export function ShieldLogo({ className }: { className?: string }) {
  const gid = `sem-shield-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.66 0.17 250)" />
          <stop offset="100%" stopColor="oklch(0.5 0.2 265)" />
        </linearGradient>
      </defs>
      <path d="M16 2.5 4.5 6.8v8.4c0 7.2 4.9 12.6 11.5 14.3 6.6-1.7 11.5-7.1 11.5-14.3V6.8L16 2.5Z" fill={`url(#${gid})`} />
      <path d="M16 5.3 7.3 8.6v6.6c0 5.6 3.7 9.9 8.7 11.4V5.3Z" fill="white" fillOpacity="0.14" />
      <path d="m11.2 16.2 3.4 3.4 6.4-7" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandMark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <ShieldLogo />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">SecureEndpoint</div>
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Manager</div>
        </div>
      )}
    </div>
  );
}
