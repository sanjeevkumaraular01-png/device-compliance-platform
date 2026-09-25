import Link from "next/link";
import { cn } from "@/lib/utils";

/** "0781" / "0x0781" → "0781" (lower-case, no prefix). */
export function normalizeHexId(value: string): string {
  return value.trim().replace(/^0x/i, "").toLowerCase();
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** VID:PID in monospace. */
export function VidPid({ vendorId, productId, className }: { vendorId: string | null | undefined; productId: string | null | undefined; className?: string }) {
  if (!vendorId && !productId) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("whitespace-nowrap font-mono text-xs", className)}>
      {vendorId ?? "????"}:{productId ?? "????"}
    </span>
  );
}

/** Link to a managed endpoint, falling back to its id. */
export function DeviceLink({ id, name, className }: { id: string | null | undefined; name?: string | null; className?: string }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <Link
      href={`/devices/${id}`}
      onClick={(e) => e.stopPropagation()}
      className={cn("font-medium text-foreground hover:text-primary hover:underline", !name && "font-mono text-xs", className)}
    >
      {name || shortId(id)}
    </Link>
  );
}

export const USB_DURATION_OPTIONS = [1, 2, 4, 8, 12, 24, 48, 72];

export function durationLabel(h: number): string {
  if (h < 24 || h % 24 !== 0) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = h / 24;
  return `${d} day${d === 1 ? "" : "s"}`;
}
