"use client";

import { Suspense } from "react";
import { TableSkeleton } from "@/components/common/states";
import { DevicesList } from "@/components/devices/devices-list";

export default function DevicesPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border bg-card">
          <TableSkeleton rows={10} />
        </div>
      }
    >
      <DevicesList />
    </Suspense>
  );
}
