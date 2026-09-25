"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeDayView } from "@/components/workforce/employee-day";

export default function EmployeeDayPage() {
  const params = useParams<{ userId: string }>();
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <EmployeeDayView userId={params.userId} />
    </React.Suspense>
  );
}
