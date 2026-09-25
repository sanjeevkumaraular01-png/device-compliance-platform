"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, RefreshCw, ShieldAlert, Sparkles, Users } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/common/status-badges";
import { UserPicker } from "@/components/users/user-picker";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { aiInsightStatusMeta, reportConsistencyMeta, workloadMeta } from "@/lib/status";
import { AiGeneratedBadge, PersonCell, fmtDay } from "@/components/workforce/common";
import { AiDisclaimer, EmployeeInsightView } from "@/components/workforce/ai-insight-view";
import { useAiInsights } from "@/components/workforce/queries";
import type { AiInsight, EmployeeInsight } from "@/types/api";

type Row = AiInsight<EmployeeInsight>;

const personName = (r: Row) => r.user?.displayName ?? "Employee";
const personSub = (r: Row) => [r.user?.jobTitle, r.user?.department?.name ?? r.department?.name].filter(Boolean).join(" · ") || undefined;

export function EmployeeInsights({
  date,
  departmentId,
  aiEnabled,
}: {
  date: string;
  departmentId: string | undefined;
  aiEnabled: boolean | undefined;
}) {
  const q = useAiInsights({ type: "EMPLOYEE_DAILY", date, departmentId });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [pickUser, setPickUser] = React.useState<{ id?: string; name?: string }>({});

  const rows = React.useMemo(() => {
    // Keep one (the newest) insight per employee.
    const byUser = new Map<string, Row>();
    for (const i of (q.data ?? []) as Row[]) {
      if (i.type !== "EMPLOYEE_DAILY") continue;
      const k = i.userId ?? i.id;
      const prev = byUser.get(k);
      if (!prev || (i.completedAt ?? i.createdAt ?? "") > (prev.completedAt ?? prev.createdAt ?? "")) byUser.set(k, i);
    }
    return [...byUser.values()].sort((a, b) => personName(a).localeCompare(personName(b)));
  }, [q.data]);

  const open = rows.find((r) => (r.userId ?? r.id) === openId) ?? null;

  const generate = useApiMutation(
    (v: { userId: string; name?: string }) => api.post<AiInsight>("/ai/insights/employee", { userId: v.userId, date }),
    {
      success: (_r, v) => `AI insight generated${v.name ? ` for ${v.name}` : ""}`,
      errorTitle: "Could not generate the insight",
      invalidate: [["ai"], ["workforce", "day"]],
    },
  );
  const { mutate: runGenerate, isPending: genPending } = generate;
  const busyUser = genPending ? generate.variables?.userId : undefined;
  const disabled = aiEnabled === false;

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "employee",
        header: "Employee",
        accessorFn: (r) => personName(r),
        meta: { label: "Employee" },
        cell: ({ row }) => (
          <PersonCell
            name={personName(row.original)}
            sub={personSub(row.original)}
            href={row.original.userId ? `/workforce/people/${row.original.userId}?date=${date}` : undefined}
            className="min-w-[160px] max-w-[220px]"
          />
        ),
      },
      {
        id: "summary",
        header: "Summary",
        enableSorting: false,
        meta: { label: "Summary" },
        cell: ({ row }) => {
          const r = row.original;
          const text = r.status === "READY" ? r.content?.summary : r.status === "FAILED" ? `Failed${r.error ? `: ${r.error}` : ""}` : null;
          return (
            <p className="line-clamp-2 min-w-[240px] max-w-[440px] text-xs" title={text ?? undefined}>
              {text ?? <span className="text-muted-foreground">{r.status === "PENDING" ? "Generating…" : "—"}</span>}
            </p>
          );
        },
      },
      {
        id: "workload",
        header: "Workload",
        enableSorting: false,
        meta: { label: "Workload" },
        cell: ({ row }) => <StatusBadge value={row.original.content?.workload ?? null} meta={workloadMeta} />,
      },
      {
        id: "report",
        header: "Report",
        enableSorting: false,
        meta: { label: "Report consistency" },
        cell: ({ row }) => <StatusBadge value={row.original.content?.reportConsistency?.status ?? null} meta={reportConsistencyMeta} />,
      },
      {
        id: "blockers",
        header: "Blockers",
        accessorFn: (r) => r.content?.blockers?.length ?? 0,
        meta: { label: "Blockers", className: "text-right tabular", headerClassName: "text-right" },
        cell: ({ row }) => {
          const n = row.original.content?.blockers?.length ?? 0;
          return n > 0 ? <span className="font-medium text-sev-high">{n}</span> : <span className="text-muted-foreground">0</span>;
        },
      },
      {
        id: "risks",
        header: "Risk flags",
        enableSorting: false,
        meta: { label: "Risk flags" },
        cell: ({ row }) => {
          const flags = row.original.content?.riskFlags ?? [];
          if (flags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex max-w-[260px] flex-wrap gap-1" title={flags.join("\n")}>
              {flags.slice(0, 2).map((f, i) => (
                <Badge key={i} tone="high" className="max-w-[200px]">
                  <ShieldAlert className="shrink-0" />
                  <span className="truncate">{f}</span>
                </Badge>
              ))}
              {flags.length > 2 && <Badge tone="neutral">+{flags.length - 2}</Badge>}
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        meta: { label: "Status" },
        cell: ({ row }) => <StatusBadge value={row.original.status} meta={aiInsightStatusMeta} />,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-px text-right" },
        cell: ({ row }) => {
          const r = row.original;
          if (!r.userId) return null;
          return (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Generate AI insight now for ${personName(r)}`}
              title="Generate now"
              disabled={disabled || genPending}
              loading={busyUser === r.userId}
              onClick={(e) => {
                e.stopPropagation();
                runGenerate({ userId: r.userId!, name: personName(r) });
              }}
            >
              {busyUser !== r.userId && <RefreshCw />}
            </Button>
          );
        },
      },
    ],
    [date, disabled, runGenerate, genPending, busyUser],
  );

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-start gap-2 border-b pb-3">
        <div className="grid grid-cols-1 min-w-0 flex-1 gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            Employee insights <AiGeneratedBadge />
          </CardTitle>
          <CardDescription>Per-employee daily summaries for {fmtDay(date, "EEEE, MMM d, yyyy")}. Click a row for the full insight.</CardDescription>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <UserPicker
            value={pickUser.id}
            onChange={(id, u) => setPickUser({ id, name: u?.displayName })}
            selectedLabel={pickUser.name}
            placeholder="Generate for employee…"
            aria-label="Employee to generate an AI insight for"
            size="sm"
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          />
          <Button
            size="sm"
            disabled={!pickUser.id || disabled || generate.isPending}
            loading={!!pickUser.id && busyUser === pickUser.id}
            title={disabled ? "AI is disabled — see the status card" : undefined}
            onClick={() => pickUser.id && generate.mutate({ userId: pickUser.id, name: pickUser.name }, { onSuccess: () => setPickUser({}) })}
          >
            <Sparkles /> Generate
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          getRowId={(r) => r.id}
          onRowClick={(r) => setOpenId(r.userId ?? r.id)}
          bordered={false}
          columnToggle={false}
          maxHeight="none"
          empty={{
            icon: Users,
            title: "No employee insights for this day",
            description:
              "Insights are generated nightly (default 20:30, org time zone) for every employee with tracked activity or a daily report. Use “Generate for employee…” to create one now.",
          }}
        />
      </CardContent>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="gap-0 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">{open ? personName(open) : "Employee insight"}</SheetTitle>
            <SheetDescription>
              {[open && personSub(open), fmtDay(date, "EEEE, MMM d, yyyy")].filter(Boolean).join(" · ")}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="grid grid-cols-1 content-start gap-4 pt-4">
            {open && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {open.userId && (
                    <Button asChild variant="outline" size="xs">
                      <Link href={`/workforce/people/${open.userId}?date=${date}`}>
                        <ExternalLink /> Employee day
                      </Link>
                    </Button>
                  )}
                  {open.userId && (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={disabled || generate.isPending}
                      loading={busyUser === open.userId}
                      aria-label={`Regenerate AI insight for ${personName(open)}`}
                      onClick={() => generate.mutate({ userId: open.userId!, name: personName(open) })}
                    >
                      <RefreshCw /> Regenerate
                    </Button>
                  )}
                </div>
                <EmployeeInsightView insight={open} />
                <AiDisclaimer />
              </>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
