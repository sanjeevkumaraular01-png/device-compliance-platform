"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { CardSkeleton } from "@/components/common/states";
import { DeviceDetail } from "@/components/devices/device-detail";

export default function DeviceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return (
    <Suspense fallback={<CardSkeleton className="h-40" />}>
      <DeviceDetail key={id} id={id} />
    </Suspense>
  );
}
