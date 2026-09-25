"use client";

import Link from "next/link";
import { Link2, ScrollText } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { CopyButton, KeyValueGrid } from "@/components/common/misc";
import { formatDateTimeSeconds } from "@/lib/format";
import type { AuditLog } from "@/types/api";
import { ActorLabel, AuditCategoryBadge, SuccessBadge } from "@/components/audit/audit-meta";
import { JsonDiff } from "@/components/audit/json-diff";

function HashRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {value ? (
        <div className="flex min-w-0 items-start gap-1 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1">
          <code className="min-w-0 flex-1 break-all py-0.5 font-mono text-[11px] leading-4">{value}</code>
          <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">— (genesis entry)</span>
      )}
    </div>
  );
}

function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export function AuditDetailSheet({ entry, open, onOpenChange }: { entry: AuditLog | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open && !!entry} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-2xl">
        {entry && (
          <>
            <SheetHeader>
              <SheetTitle className="flex min-w-0 items-center gap-2">
                <ScrollText className="size-4 shrink-0 text-primary" />
                <span className="truncate font-mono text-sm">{entry.action}</span>
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">#{entry.id}</span>
                <span aria-hidden>·</span>
                <span className="text-xs">{formatDateTimeSeconds(entry.occurredAt)}</span>
                <AuditCategoryBadge value={entry.category} />
                <SuccessBadge success={entry.success} />
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="grid content-start gap-5 pt-4">
              <KeyValueGrid
                items={[
                  { label: "Actor", value: <ActorLabel type={entry.actorType} name={entry.actorName} id={entry.actorId} /> },
                  { label: "Actor ID", value: entry.actorId, mono: true },
                  { label: "Resource type", value: entry.resourceType },
                  { label: "Resource ID", value: entry.resourceId, mono: true },
                  {
                    label: "Device",
                    value: entry.deviceId ? (
                      <Link href={`/devices/${entry.deviceId}`} className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                        <Link2 className="size-3" />
                        {entry.deviceId.slice(0, 8)}…
                      </Link>
                    ) : null,
                  },
                  { label: "IP address", value: entry.ipAddress, mono: true },
                ]}
              />
              {entry.userAgent && (
                <div className="grid gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">User agent</span>
                  <p className="break-all text-xs text-muted-foreground">{entry.userAgent}</p>
                </div>
              )}

              <Separator />

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Changes</h3>
                <JsonDiff before={entry.before} after={entry.after} />
              </section>

              {hasContent(entry.metadata) && (
                <section className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Metadata</h3>
                    <CopyButton value={JSON.stringify(entry.metadata, null, 2)} label="Copy metadata" />
                  </div>
                  <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-4 scrollbar-thin">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </section>
              )}

              <Separator />

              <section className="grid gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Integrity</h3>
                  <p className="text-xs text-muted-foreground">Each entry&apos;s hash covers its content and the previous entry&apos;s hash, forming a tamper-evident chain.</p>
                </div>
                <HashRow label="Hash" value={entry.hash} />
                <HashRow label="Previous hash" value={entry.prevHash} />
              </section>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
