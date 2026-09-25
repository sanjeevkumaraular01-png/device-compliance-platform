"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Globe, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { Field } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { normalizeList } from "@/hooks/use-list-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IpRestriction, Paginated } from "@/types/api";
import { validateCidr } from "@/components/settings/net-utils";
import { useSessions } from "@/components/settings/sessions-tab";

function AddRuleDialog({ open, onOpenChange, currentIp }: { open: boolean; onOpenChange: (o: boolean) => void; currentIp?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add allowed network</DialogTitle>
          <DialogDescription>Console API requests are only accepted from addresses inside an allowed range.</DialogDescription>
        </DialogHeader>
        <AddRuleForm onDone={() => onOpenChange(false)} currentIp={currentIp} />
      </DialogContent>
    </Dialog>
  );
}

function AddRuleForm({ onDone, currentIp }: { onDone: () => void; currentIp?: string | null }) {
  const [cidr, setCidr] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const error = validateCidr(cidr);

  const add = useApiMutation((v: { cidr: string; description?: string }) => api.post<IpRestriction>("/settings/ip-restrictions", v), {
    success: (_d, v) => `${v.cidr} added to the allow list`,
    invalidate: [["settings", "ip-restrictions"]],
    onSuccess: onDone,
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (error) return;
        add.mutate({ cidr: cidr.trim(), description: description.trim() || undefined });
      }}
    >
      <Field
        label="CIDR"
        htmlFor="ip-cidr"
        required
        error={touched ? (error ?? undefined) : undefined}
        hint="IPv4 or IPv6 range, e.g. 10.0.0.0/8, 203.0.113.7/32 or 2001:db8::/32."
      >
        <Input
          id="ip-cidr"
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="10.0.0.0/8"
          className="font-mono"
          aria-invalid={touched && !!error}
          autoFocus
        />
      </Field>
      {currentIp && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Your current address appears to be <span className="font-mono text-foreground">{currentIp}</span>.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => setCidr(currentIp.includes(":") ? `${currentIp}/128` : `${currentIp}/32`)}>
            Use it
          </button>
        </p>
      )}
      <Field label="Description" htmlFor="ip-desc">
        <Input id="ip-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Head office VPN egress" maxLength={255} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={add.isPending}>
          Add network
        </Button>
      </DialogFooter>
    </form>
  );
}

export function IpRestrictionsTab() {
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = React.useState(false);
  const sessions = useSessions();
  const currentIp = sessions.data?.find((s) => s.current)?.ipAddress ?? null;

  const query = useQuery({
    queryKey: ["settings", "ip-restrictions"],
    queryFn: async ({ signal }) =>
      normalizeList(await api.get<Paginated<IpRestriction> | IpRestriction[]>("/settings/ip-restrictions", undefined, { signal })).data,
  });
  const rules = React.useMemo(() => query.data ?? [], [query.data]);
  const enabledCount = rules.filter((r) => r.enabled).length;

  const { mutate: removeRule } = useApiMutation((r: IpRestriction) => api.delete(`/settings/ip-restrictions/${r.id}`), {
    success: (_d, r) => `${r.cidr} removed`,
    invalidate: [["settings", "ip-restrictions"]],
  });

  const onDelete = React.useCallback(
    async (r: IpRestriction) => {
      const last = r.enabled && rules.filter((x) => x.enabled).length === 1;
      if (
        await confirm({
          title: `Remove ${r.cidr}?`,
          description: last
            ? "This is the last enabled rule. Removing it disables IP restrictions entirely — the console will accept requests from any address."
            : "Requests from this range will be blocked unless another rule allows them. Make sure your own address stays covered.",
          confirmLabel: "Remove",
          destructive: true,
          typeToConfirm: r.cidr,
        })
      ) {
        removeRule(r);
      }
    },
    [confirm, removeRule, rules],
  );

  const columns = React.useMemo<ColumnDef<IpRestriction, unknown>[]>(
    () => [
      {
        accessorKey: "cidr",
        header: "Network",
        meta: { label: "Network" },
        cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.cidr}</span>,
      },
      {
        accessorKey: "description",
        header: "Description",
        meta: { label: "Description" },
        cell: ({ row }) =>
          row.original.description ? <span className="block max-w-[18rem] truncate text-xs">{row.original.description}</span> : <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "enabled",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => (
          <Badge tone={row.original.enabled ? "success" : "neutral"} dot>
            {row.original.enabled ? "Enabled" : "Disabled"}
          </Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Added",
        meta: { label: "Added", className: "whitespace-nowrap text-xs text-muted-foreground" },
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) => (
          <SimpleTooltip label="Remove rule">
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${row.original.cidr}`} onClick={() => onDelete(row.original)}>
              <Trash2 />
            </Button>
          </SimpleTooltip>
        ),
      },
    ],
    [onDelete],
  );

  return (
    <div className="grid max-w-4xl gap-4">
      <div
        role="note"
        className={cn(
          "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs",
          enabledCount > 0 ? "border-sev-medium/40 bg-sev-medium/10" : "bg-muted/40",
        )}
      >
        <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", enabledCount > 0 ? "text-sev-medium" : "text-muted-foreground")} />
        <div className="grid gap-0.5">
          <p className="font-semibold">
            {enabledCount > 0 ? `IP allow-listing is active (${enabledCount} enabled rule${enabledCount === 1 ? "" : "s"})` : "IP allow-listing is off"}
          </p>
          <p className="text-muted-foreground">
            When at least one enabled rule exists, console API requests from any other IP address are rejected with 403. Endpoint agent traffic is
            exempt. Always keep a rule that covers your own address so you don&apos;t lock yourself out.
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rules}
        loading={query.isLoading}
        fetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        getRowId={(r) => r.id}
        columnToggle={false}
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add network
          </Button>
        }
        empty={{
          icon: Globe,
          title: "No IP restrictions",
          description: "The console is reachable from any address. Add your office or VPN ranges to restrict access.",
        }}
      />
      <AddRuleDialog open={addOpen} onOpenChange={setAddOpen} currentIp={currentIp} />
    </div>
  );
}
