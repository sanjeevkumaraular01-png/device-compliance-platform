"use client";

import { Clock, ShieldCheck, Usb, UserCheck } from "lucide-react";
import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Can } from "@/lib/auth";
import { UsbRequestDialog } from "@/components/usb/usb-request-dialog";
import { UsbRequestsTable } from "@/components/usb/usb-requests-table";

const steps = [
  { icon: Usb, title: "Identify the device", text: "Find the vendor and product ID (VID/PID) printed in the block notification or on the device packaging." },
  { icon: UserCheck, title: "Explain the need", text: "Describe why you need the device. Your manager or IT reviews every request." },
  { icon: Clock, title: "Time-limited access", text: "Once approved, access is granted for a fixed duration and then removed automatically." },
];

/** Self-service view for users who can request USB access but cannot view fleet-wide USB data. */
export function UsbEmployeeView() {
  return (
    <div>
      <PageHeader
        title="USB Access"
        icon={Usb}
        description="USB storage devices are blocked on company computers to protect corporate data."
        actions={
          <Can permission="usb:request">
            <UsbRequestDialog />
          </Can>
        }
      />
      <Card className="mb-5">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.title} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <s.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{s.title}</div>
                <p className="text-xs text-muted-foreground">{s.text}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <SectionTitle title="My requests" description="Status of your temporary USB access requests" />
      <UsbRequestsTable mode="self" />
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Keyboards, mice and other non-storage devices are not affected by this policy.
      </p>
    </div>
  );
}
