"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileKey2, Terminal } from "lucide-react";
import { api } from "@/lib/api";
import { OS_PLATFORMS, type EnrollmentToken, type InstallCommand, type OsPlatform } from "@/types/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyButton, Field } from "@/components/common/misc";
import { ErrorState, EmptyState } from "@/components/common/states";
import { OsIcon } from "@/components/common/os-icon";
import { platformLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CA_CERT_PATH, SHELL_BY_PLATFORM, tokenState } from "@/components/enrollment/enrollment-queries";

/** Terminal-style code block (dark in both themes, built from theme tokens). */
export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-md border bg-foreground text-background dark:bg-background dark:text-foreground", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-background/15 px-3 py-1.5 dark:border-border">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide opacity-70">
          <Terminal className="size-3.5 shrink-0" />
          <span className="truncate">{label ?? "Command"}</span>
        </span>
        <CopyButton value={code} label="Copy command" className="text-current hover:bg-background/15 hover:text-current dark:hover:bg-accent" />
      </div>
      <pre className="max-h-72 overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InstallCommandView({ tokenId, platform }: { tokenId: string; platform: OsPlatform }) {
  const q = useQuery({
    queryKey: ["enrollment", "install-command", tokenId, platform],
    queryFn: ({ signal }) => api.get<InstallCommand>("/enrollment/install-command", { tokenId, platform }, { signal }),
    staleTime: 5 * 60_000,
  });
  const meta = SHELL_BY_PLATFORM[platform];

  if (q.isLoading) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-3 w-48" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} compact />;

  return (
    <div className="grid gap-2.5">
      <CodeBlock code={q.data.command} label={`${platformLabel[platform]} · ${meta.shell}`} />
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{meta.hint}</span>
        {q.data.downloadUrl && (
          <a
            href={q.data.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
          >
            <Download className="size-3.5" /> Download agent package
          </a>
        )}
      </div>
    </div>
  );
}

/** Platform tabs (Windows / Linux / macOS) rendering the API-generated install one-liner. */
export function InstallCommandTabs({ tokenId, defaultPlatform }: { tokenId: string; defaultPlatform?: OsPlatform | null }) {
  const [platform, setPlatform] = React.useState<OsPlatform>(defaultPlatform ?? "WINDOWS");
  const platforms = defaultPlatform ? [defaultPlatform] : OS_PLATFORMS;
  return (
    <Tabs value={platform} onValueChange={(v) => setPlatform(v as OsPlatform)}>
      <TabsList variant="pill">
        {platforms.map((p) => (
          <TabsTrigger key={p} value={p}>
            <OsIcon platform={p} className="size-3.5" />
            {platformLabel[p]}
            <span className="hidden text-muted-foreground sm:inline">({SHELL_BY_PLATFORM[p].shell})</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {platforms.map((p) => (
        <TabsContent key={p} value={p} className="mt-3">
          <InstallCommandView tokenId={tokenId} platform={p} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function CaCertNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <FileKey2 className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Agents pin the server certificate using the enrollment CA. The install scripts fetch it automatically; for offline or
        golden-image installs download it from{" "}
        <a href={CA_CERT_PATH} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">
          {CA_CERT_PATH}
        </a>
        .
      </span>
    </p>
  );
}

/** Generator: pick an active token → per-platform command. */
export function InstallCommandGenerator({ tokens, loading }: { tokens: EnrollmentToken[]; loading?: boolean }) {
  const active = React.useMemo(() => tokens.filter((t) => tokenState(t) === "active"), [tokens]);
  const [selected, setSelected] = React.useState<string | undefined>(undefined);
  const tokenId = selected && active.some((t) => t.id === selected) ? selected : active[0]?.id;
  const token = active.find((t) => t.id === tokenId);

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (active.length === 0) {
    return (
      <EmptyState
        icon={Terminal}
        title="No active enrollment tokens"
        description="Create an enrollment token first. Install commands are generated per token and platform."
        compact
      />
    );
  }

  return (
    <div className="grid gap-4">
      <Field label="Enrollment token" htmlFor="install-token" hint="Only active tokens (not revoked, expired or exhausted) are listed." className="max-w-md">
        <Select value={tokenId} onValueChange={setSelected}>
          <SelectTrigger id="install-token">
            <SelectValue placeholder="Select a token" />
          </SelectTrigger>
          <SelectContent>
            {active.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="truncate">{t.name}</span>
                <span className="ml-1 font-mono text-[11px] text-muted-foreground">{t.tokenPrefix}…</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {token && <InstallCommandTabs key={token.id} tokenId={token.id} defaultPlatform={token.platform} />}
      <p className="text-xs text-muted-foreground">
        The raw token secret is only displayed once, when the token is created. If the command contains a token placeholder,
        substitute the secret you stored at creation time.
      </p>
      <CaCertNote />
    </div>
  );
}
