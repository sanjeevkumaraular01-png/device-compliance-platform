"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldHalf, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApiMutation } from "@/hooks/use-api-mutation";
import type { DevicePolicy } from "@/types/api";
import { PageHeader } from "@/components/common/page-header";
import { CardSkeleton, ErrorState } from "@/components/common/states";
import { RelativeTime } from "@/components/common/misc";
import { useConfirm } from "@/components/common/confirm-dialog";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { PolicyEditor } from "@/components/policies/policy-editor";
import { PolicyAssignmentCard } from "@/components/policies/policy-assignment";
import { formatDateTime } from "@/lib/format";

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can("policies:write");
  const confirm = useConfirm();

  const q = useQuery({
    queryKey: ["policies", "detail", id],
    queryFn: ({ signal }) => api.get<DevicePolicy>(`/policies/${id}`, undefined, { signal }),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
  const policy = q.data;
  useBreadcrumbLabel(policy?.name);

  const remove = useApiMutation((p: DevicePolicy) => api.delete(`/policies/${p.id}`), {
    success: (_d, p) => `Policy “${p.name}” deleted`,
    invalidate: [["policies"], ["devices"]],
    onSuccess: () => router.push("/policies"),
  });

  const onDelete = async () => {
    if (!policy) return;
    const ok = await confirm({
      title: `Delete policy “${policy.name}”?`,
      description:
        "Assigned devices and departments fall back to their department policy or the default policy and are re-evaluated for compliance.",
      confirmLabel: "Delete policy",
      destructive: true,
      typeToConfirm: policy.name,
    });
    if (ok) remove.mutate(policy);
  };

  if (q.isLoading) {
    return (
      <div className="grid gap-4">
        <CardSkeleton className="h-20" />
        <CardSkeleton className="h-48" />
        <CardSkeleton className="h-48" />
      </div>
    );
  }
  if (q.isError || !policy) {
    return (
      <div className="grid gap-4">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link href="/policies">
            <ArrowLeft /> All policies
          </Link>
        </Button>
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Policy could not be loaded" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        icon={ShieldHalf}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{policy.name}</span>
            <Badge tone="neutral" className="shrink-0 font-mono">
              v{policy.version}
            </Badge>
            {policy.isDefault && (
              <Badge tone="primary" className="shrink-0">
                Default
              </Badge>
            )}
          </span>
        }
        description={
          <span>
            {policy.description ? `${policy.description} · ` : ""}
            Updated <RelativeTime value={policy.updatedAt} /> <span className="hidden sm:inline">({formatDateTime(policy.updatedAt)})</span>
          </span>
        }
        actions={
          canWrite ? (
            policy.isDefault ? (
              <SimpleTooltip label="The default policy cannot be deleted">
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled>
                    <Trash2 /> Delete
                  </Button>
                </span>
              </SimpleTooltip>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
                loading={remove.isPending}
              >
                <Trash2 /> Delete
              </Button>
            )
          ) : undefined
        }
      />
      <PolicyEditor
        key={`${policy.id}:${policy.version}`}
        policy={policy}
        readOnly={!canWrite}
        assignment={<PolicyAssignmentCard policy={policy} />}
      />
    </>
  );
}
