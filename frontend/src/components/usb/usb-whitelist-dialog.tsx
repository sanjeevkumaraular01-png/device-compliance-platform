"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments, useDeviceSearch, useUserSearch } from "@/hooks/use-lookups";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { EntityPicker } from "@/components/usb/entity-picker";
import { normalizeHexId, shortId } from "@/components/usb/usb-utils";
import { USB_DEVICE_CLASSES, WHITELIST_SCOPES, type UsbDevice, type UsbDeviceClass, type UsbWhitelistInput, type WhitelistScope } from "@/types/api";

const hex4 = z
  .string()
  .trim()
  .regex(/^(0x)?[0-9a-fA-F]{4}$/, "4 hex digits, e.g. 0781");

const schema = z
  .object({
    vendorId: hex4,
    productId: hex4,
    serialNumber: z.string().trim().max(128),
    productName: z.string().trim().max(200),
    manufacturer: z.string().trim().max(200),
    deviceClass: z.enum(USB_DEVICE_CLASSES),
    whitelistScope: z.enum(WHITELIST_SCOPES),
    scopeRefId: z.string(),
    readOnly: z.boolean(),
    notes: z.string().trim().max(1000),
  })
  .superRefine((v, ctx) => {
    if (v.whitelistScope !== "GLOBAL" && !v.scopeRefId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scopeRefId"], message: `Select the ${v.whitelistScope.toLowerCase()} this approval applies to` });
    }
  });

type FormValues = z.infer<typeof schema>;

export type UsbWhitelistPrefill = Partial<Pick<UsbWhitelistInput, "vendorId" | "productId" | "serialNumber" | "productName" | "manufacturer" | "deviceClass">>;

const scopeHelp: Record<WhitelistScope, string> = {
  GLOBAL: "Allowed on every managed endpoint",
  DEPARTMENT: "Allowed on endpoints belonging to one department",
  USER: "Allowed only for one user's sessions",
  DEVICE: "Allowed only on one endpoint",
};

function toForm(device?: UsbDevice | null, prefill?: UsbWhitelistPrefill | null): FormValues {
  return {
    vendorId: device?.vendorId ?? prefill?.vendorId ?? "",
    productId: device?.productId ?? prefill?.productId ?? "",
    serialNumber: device?.serialNumber ?? prefill?.serialNumber ?? "",
    productName: device?.productName ?? prefill?.productName ?? "",
    manufacturer: device?.manufacturer ?? prefill?.manufacturer ?? "",
    deviceClass: (device?.deviceClass ?? prefill?.deviceClass ?? "MASS_STORAGE") as UsbDeviceClass,
    whitelistScope: device?.whitelistScope ?? "GLOBAL",
    scopeRefId: device?.scopeRefId ?? "",
    readOnly: device?.readOnly ?? false,
    notes: device?.notes ?? "",
  };
}

/** Add (POST /usb/devices) or edit (PATCH /usb/devices/:id) a whitelisted USB device. */
export function UsbWhitelistDialog({
  open,
  onOpenChange,
  device,
  prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  device?: UsbDevice | null;
  prefill?: UsbWhitelistPrefill | null;
}) {
  const editing = !!device;
  const { can } = useAuth();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(device, prefill) });
  const errors = form.formState.errors;
  const scope = form.watch("whitelistScope");
  const scopeRefId = form.watch("scopeRefId");

  const [refLabel, setRefLabel] = React.useState<string | undefined>();
  const [userSearch, setUserSearch] = React.useState("");
  const [deviceSearch, setDeviceSearch] = React.useState("");
  const debUser = useDebounce(userSearch, 300);
  const debDevice = useDebounce(deviceSearch, 300);

  const departments = useDepartments(open && scope === "DEPARTMENT");
  const users = useUserSearch(debUser, open && scope === "USER");
  const devices = useDeviceSearch(debDevice, open && scope === "DEVICE");

  React.useEffect(() => {
    if (open) {
      form.reset(toForm(device, prefill));
      setRefLabel(device?.scopeRefId ? shortId(device.scopeRefId) : undefined);
      setUserSearch("");
      setDeviceSearch("");
    }
  }, [open, device, prefill, form]);

  const mutation = useApiMutation(
    (body: Omit<UsbWhitelistInput, "scopeRefId"> & { scopeRefId?: string | null }) =>
      device ? api.patch<UsbDevice>(`/usb/devices/${device.id}`, body) : api.post<UsbDevice>("/usb/devices", body),
    {
      success: editing ? "Whitelist entry updated" : "USB device added to the whitelist",
      invalidate: [["usb"]],
      onSuccess: () => onOpenChange(false),
    },
  );

  const onSubmit = form.handleSubmit((v) => {
    // Create: omit empty optionals. Edit: send "" so a cleared field is actually cleared.
    const opt = (s: string) => (s ? s : editing ? "" : undefined);
    mutation.mutate({
      vendorId: normalizeHexId(v.vendorId),
      productId: normalizeHexId(v.productId),
      serialNumber: opt(v.serialNumber),
      productName: opt(v.productName),
      manufacturer: opt(v.manufacturer),
      deviceClass: v.deviceClass,
      whitelistScope: v.whitelistScope,
      scopeRefId: v.whitelistScope === "GLOBAL" ? (editing ? null : undefined) : v.scopeRefId,
      readOnly: v.readOnly,
      notes: opt(v.notes),
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit whitelisted USB device" : "Whitelist a USB device"}</DialogTitle>
          <DialogDescription>
            Whitelisted devices bypass the USB storage block for the selected scope. Match on serial number for the tightest control.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor ID (VID)" htmlFor="wl-vid" error={errors.vendorId?.message} required>
              <Input id="wl-vid" placeholder="0781" className="font-mono" aria-invalid={!!errors.vendorId || undefined} {...form.register("vendorId")} />
            </Field>
            <Field label="Product ID (PID)" htmlFor="wl-pid" error={errors.productId?.message} required>
              <Input id="wl-pid" placeholder="5581" className="font-mono" aria-invalid={!!errors.productId || undefined} {...form.register("productId")} />
            </Field>
          </div>
          <Field label="Serial number" htmlFor="wl-serial" hint="Leave empty to allow every unit of this model" error={errors.serialNumber?.message}>
            <Input id="wl-serial" className="font-mono" {...form.register("serialNumber")} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Product name" htmlFor="wl-product" error={errors.productName?.message}>
              <Input id="wl-product" placeholder="Ultra Fit" {...form.register("productName")} />
            </Field>
            <Field label="Manufacturer" htmlFor="wl-manufacturer" error={errors.manufacturer?.message}>
              <Input id="wl-manufacturer" placeholder="SanDisk" {...form.register("manufacturer")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Device class" htmlFor="wl-class" required>
              <Controller
                control={form.control}
                name="deviceClass"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="wl-class">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USB_DEVICE_CLASSES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {humanize(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Scope" htmlFor="wl-scope" hint={scopeHelp[scope]} required>
              <Controller
                control={form.control}
                name="whitelistScope"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue("scopeRefId", "");
                      setRefLabel(undefined);
                    }}
                  >
                    <SelectTrigger id="wl-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WHITELIST_SCOPES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {humanize(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          {scope === "DEPARTMENT" && (
            <Field label="Department" htmlFor="wl-ref" error={errors.scopeRefId?.message} required>
              <Controller
                control={form.control}
                name="scopeRefId"
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger id="wl-ref" aria-invalid={!!errors.scopeRefId || undefined}>
                      <SelectValue placeholder={departments.isLoading ? "Loading departments…" : "Select a department"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(departments.data ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          )}
          {scope === "USER" && (
            <Field
              label="User"
              htmlFor="wl-ref"
              error={errors.scopeRefId?.message}
              hint={!can("users:read") ? "Your role cannot search users — ask an administrator." : undefined}
              required
            >
              <EntityPicker
                id="wl-ref"
                value={scopeRefId || undefined}
                selectedLabel={refLabel}
                onChange={(it) => {
                  form.setValue("scopeRefId", it.id, { shouldValidate: true });
                  setRefLabel(it.label);
                }}
                items={(users.data ?? []).map((u) => ({ id: u.id, label: u.displayName, sub: u.email }))}
                loading={users.isFetching && !users.data}
                search={userSearch}
                onSearchChange={setUserSearch}
                placeholder="Select a user"
                searchPlaceholder="Search by name or email…"
                invalid={!!errors.scopeRefId}
              />
            </Field>
          )}
          {scope === "DEVICE" && (
            <Field label="Endpoint" htmlFor="wl-ref" error={errors.scopeRefId?.message} required>
              <EntityPicker
                id="wl-ref"
                value={scopeRefId || undefined}
                selectedLabel={refLabel}
                onChange={(it) => {
                  form.setValue("scopeRefId", it.id, { shouldValidate: true });
                  setRefLabel(it.label);
                }}
                items={(devices.data ?? []).map((d) => ({ id: d.id, label: d.deviceName, sub: d.serialNumber }))}
                loading={devices.isFetching && !devices.data}
                search={deviceSearch}
                onSearchChange={setDeviceSearch}
                placeholder="Select an endpoint"
                searchPlaceholder="Search by name or serial…"
                invalid={!!errors.scopeRefId}
              />
            </Field>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <div className="text-xs font-medium">Read-only</div>
              <div className="text-[11px] text-muted-foreground">Mount the device without write access</div>
            </div>
            <Controller
              control={form.control}
              name="readOnly"
              render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Read-only" />}
            />
          </div>
          <Field label="Notes" htmlFor="wl-notes" error={errors.notes?.message}>
            <Textarea id="wl-notes" rows={2} placeholder="e.g. Encrypted drive issued to Finance for audits" {...form.register("notes")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? "Save changes" : "Add to whitelist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
