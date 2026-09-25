import { cn } from "@/lib/utils";
import type { OsPlatform } from "@/types/api";
import { platformLabel } from "@/lib/format";

/** Monochrome brand-neutral OS glyphs (inline SVG, inherit currentColor). */
export function OsIcon({ platform, className, withLabel = false }: { platform: OsPlatform | null | undefined; className?: string; withLabel?: boolean }) {
  const icon = (() => {
    switch (platform) {
      case "WINDOWS":
        return (
          <svg viewBox="0 0 24 24" className={cn("size-4 text-[#2b88d8]", className)} fill="currentColor" aria-hidden>
            <path d="M3 5.5 10.5 4.4v7.1H3V5.5Zm0 13 7.5 1.1v-7H3v5.9ZM11.4 4.3 21 3v8.5h-9.6V4.3Zm0 15.4L21 21v-8.4h-9.6v7.1Z" />
          </svg>
        );
      case "MACOS":
        return (
          <svg viewBox="0 0 24 24" className={cn("size-4 text-foreground/80", className)} fill="currentColor" aria-hidden>
            <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.9-3.1-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3.1.7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.3Z" />
          </svg>
        );
      case "LINUX":
        return (
          <svg viewBox="0 0 24 24" className={cn("size-4 text-[#e0a100]", className)} fill="currentColor" aria-hidden>
            <path d="M12 2c-2.2 0-3.6 1.8-3.6 4.4 0 1.3.2 2.1-.6 3.4-.9 1.4-2.6 3.5-2.6 6 0 .7.1 1.3.4 1.8-.6.3-1.2.8-1.1 1.5.2 1 1.6 1 2.6 1.4 1 .4 1.8 1.2 2.8 1.2.9 0 1.4-.6 2.1-.6s1.2.6 2.1.6c1 0 1.8-.8 2.8-1.2 1-.4 2.4-.4 2.6-1.4.1-.7-.5-1.2-1.1-1.5.3-.5.4-1.1.4-1.8 0-2.5-1.7-4.6-2.6-6-.8-1.3-.6-2.1-.6-3.4C15.6 3.8 14.2 2 12 2Zm-1.5 4.3c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1Zm3 0c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1ZM12 9.2c.8 0 2 .6 2 .9 0 .4-1.2 1.1-2 1.1s-2-.7-2-1.1c0-.3 1.2-.9 2-.9Z" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" className={cn("size-4 text-muted-foreground", className)} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
        );
    }
  })();
  if (!withLabel) return <span title={platform ? platformLabel[platform] : "Unknown"} className="inline-flex">{icon}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      <span>{platform ? platformLabel[platform] : "Unknown"}</span>
    </span>
  );
}
