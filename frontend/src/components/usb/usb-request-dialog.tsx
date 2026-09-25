"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Usb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDeviceSearch } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import type { UsbAccessRequest, UsbAccessRequestInput } from "@/types/api";

const hex4 = z
  .string()
  .trim()
  .regex(/^(0x)?[0-9a-fA-F]{4}$/, "4 hex digits, e.g. 0781");

const schema = z.object({
  deviceId: z.string().min(1, "Select the computer the USB device will be used on"),
  vendorId: hex4,
  productId: hex4,
  serialNumber: z.string().trim().max(128).optional(),
  reason: z.string().trim().min(10, "Please describe the business need (min. 10 characters)").max(1000),
  durationHours: z.coerce.number().int().min(1, "Minimum 1 hour").max(72, "Maximum 72 hours"),
  readOnly: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const DURATIONS = [1, 2, 4, 8, 24, 48, 72];

/**
 * Temporary USB access request (POST /usb/requests). Used by employees (dashboard / USB Access page)
 * and admins. `defaultDeviceId` preselects the endpoint.
 */
export function UsbRequestDialog({
  trigger,
  defaultDeviceId,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  defaultDeviceId?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  const devices = useDeviceSearch("", open);

  const form = useForm<z.input<typeof schema>, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { deviceId: defaultDeviceId ?? "", vendorId: "", productId: "", serialNumber: "", reason: "", durationHours: 4, readOnly: true },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ deviceId: defaultDeviceId ?? "", vendorId: "", productId: "", serialNumber: "", reason: "", durationHours: 4, readOnly: true });
    }
  }, [open, defaultDeviceId, form]);

  React.useEffect(() => {
    // Auto-select when the user has exactly one device.
    if (open && !form.getValues("deviceId") && devices.data?.length === 1) form.setValue("deviceId", devices.data[0].id);
  }, [open, devices.data, form]);

  const mutation = useApiMutation((body: UsbAccessRequestInput) => api.post<UsbAccessRequest>("/usb/requests", body), {
    success: "Access request submitted — you will be notified once it is reviewed",
    invalidate: [["usb"]],
    onSuccess: () => setOpen(false),
  });

  const onSubmit = form.handleSubmit((v) =>
    mutation.mutate({
      deviceId: v.deviceId,
      vendorId: v.vendorId.replace(/^0x/i, "").toLowerCase(),
      productId: v.productId.replace(/^0x/i, "").toLowerCase(),
      serialNumber: v.serialNumber || undefined,
      reason: v.reason,
      durationHours: v.durationHours,
      readOnly: v.readOnly,
    }),
  );

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button>
            <Usb /> Request USB access
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request temporary USB access</DialogTitle>
          <DialogDescription>
            Removable storage is blocked by policy. Request time-limited access for a specific USB device; an approver will review it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Computer" htmlFor="usb-device" error={errors.deviceId?.message} required>
            <Controller
              control={form.control}
              name="deviceId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="usb-device" aria-invalid={!!errors.deviceId || undefined}>
                    <SelectValue placeholder={devices.isLoading ? "Loading devices…" : "Select a device"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(devices.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.deviceName} · {d.serialNumber}
                      </SelectItem>
                    ))}
                    {devices.data?.length === 0 && (
                      <div className="px-2 py-2 text-xs text-muted-foreground">No devices are assigned to you.</div>
                    )}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor ID (VID)" htmlFor="usb-vid" error={errors.vendorId?.message} required>
              <Input id="usb-vid" placeholder="0781" className="font-mono" aria-invalid={!!errors.vendorId || undefined} {...form.register("vendorId")} />
            </Field>
            <Field label="Product ID (PID)" htmlFor="usb-pid" error={errors.productId?.message} required>
              <Input id="usb-pid" placeholder="5581" className="font-mono" aria-invalid={!!errors.productId || undefined} {...form.register("productId")} />
            </Field>
          </div>
          <Field label="Serial number" htmlFor="usb-serial" hint="Optional — restricts access to this exact device" error={errors.serialNumber?.message}>
            <Input id="usb-serial" className="font-mono" {...form.register("serialNumber")} />
          </Field>
          <Field label="Business justification" htmlFor="usb-reason" error={errors.reason?.message} required>
            <Textarea id="usb-reason" rows={3} placeholder="e.g. Transfer signed contracts to the client's encrypted drive" aria-invalid={!!errors.reason || undefined} {...form.register("reason")} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Duration" htmlFor="usb-duration" error={errors.durationHours?.message}>
              <Controller
                control={form.control}
                name="durationHours"
                render={({ field }) => (
                  <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger id="usb-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATIONS.map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {h < 24 ? `${h} hour${h > 1 ? "s" : ""}` : `${h / 24} day${h > 24 ? "s" : ""}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div>
                <div className="text-xs font-medium">Read-only</div>
                <div className="text-[11px] text-muted-foreground">Block writes to the device</div>
              </div>
              <Controller
                control={form.control}
                name="readOnly"
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Read-only access" />}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
