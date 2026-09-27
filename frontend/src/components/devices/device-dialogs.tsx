"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Loader2, Search, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { EmptyState } from "@/components/common/states";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments, useDeviceGroups, usePolicies, useUserSearch } from "@/hooks/use-lookups";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermission } from "@/lib/auth";
import { api } from "@/lib/api";
import { humanize, platformLabel, toIsoDateInput } from "@/lib/format";
import { cn, initials } from "@/lib/utils";
import { DEVICE_TYPES, OS_PLATFORMS, type Device, type DeviceType, type OsPlatform } from "@/types/api";

const NONE = "__none";

const optionalText = z.string().trim().max(200).optional();

function toNullableDate(v: string | undefined): string | null {
  return v ? v : null;
}

// ───────────────────────────── Add (pre-register) device ─────────────────────────────

const addSchema = z.object({
  deviceName: z.string().trim().min(1, "Device name is required").max(128),
  serialNumber: z.string().trim().min(1, "Serial number is required").max(128),
  assetId: optionalText,
  platform: z.enum(OS_PLATFORMS),
  deviceType: z.enum(DEVICE_TYPES),
  manufacturer: optionalText,
  model: optionalText,
  departmentId: z.string(),
  purchaseDate: z.string().optional(),
  warrantyExpiresAt: z.string().optional(),
  isCompanyOwned: z.boolean(),
});
type AddValues = z.infer<typeof addSchema>;

const addDefaults: AddValues = {
  deviceName: "",
  serialNumber: "",
  assetId: "",
  platform: "WINDOWS",
  deviceType: "LAPTOP",
  manufacturer: "",
  model: "",
  departmentId: NONE,
  purchaseDate: "",
  warrantyExpiresAt: "",
  isCompanyOwned: true,
};

export function AddDeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const departments = useDepartments(open);
  const form = useForm<AddValues>({ resolver: zodResolver(addSchema), defaultValues: addDefaults });

  React.useEffect(() => {
    if (open) form.reset(addDefaults);
  }, [open, form]);

  const mutation = useApiMutation((body: Record<string, unknown>) => api.post<Device>("/devices", body), {
    success: (d) => `${d.deviceName} pre-registered — it will activate when the agent enrolls`,
    invalidate: [["devices"], ["dashboard"]],
    onSuccess: (d) => {
      onOpenChange(false);
      if (d?.id) router.push(`/devices/${d.id}`);
    },
  });

  const onSubmit = form.handleSubmit((v) => {
    const body: Record<string, unknown> = {
      deviceName: v.deviceName,
      serialNumber: v.serialNumber,
      platform: v.platform,
      deviceType: v.deviceType,
      isCompanyOwned: v.isCompanyOwned,
    };
    if (v.assetId) body.assetId = v.assetId;
    if (v.manufacturer) body.manufacturer = v.manufacturer;
    if (v.model) body.model = v.model;
    if (v.departmentId !== NONE) body.departmentId = v.departmentId;
    if (v.purchaseDate) body.purchaseDate = v.purchaseDate;
    if (v.warrantyExpiresAt) body.warrantyExpiresAt = v.warrantyExpiresAt;
    mutation.mutate(body);
  });

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add device</DialogTitle>
          <DialogDescription>
            Pre-register a company asset. It stays <span className="font-medium">Pending</span> until the agent enrolls with the same serial number.
          </DialogDescription>
        </DialogHeader>
        <form id="add-device-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Device name" htmlFor="add-deviceName" error={errors.deviceName?.message} required>
            <Input id="add-deviceName" placeholder="FIN-LT-0142" {...form.register("deviceName")} />
          </Field>
          <Field label="Serial number" htmlFor="add-serialNumber" error={errors.serialNumber?.message} required>
            <Input id="add-serialNumber" className="font-mono" {...form.register("serialNumber")} />
          </Field>
          <Field label="Asset ID" htmlFor="add-assetId" hint="Leave empty to auto-generate" error={errors.assetId?.message}>
            <Input id="add-assetId" className="font-mono" {...form.register("assetId")} />
          </Field>
          <Field label="Platform" htmlFor="add-platform" required>
            <Controller
              control={form.control}
              name="platform"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as OsPlatform)}>
                  <SelectTrigger id="add-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OS_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {platformLabel[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Device type" htmlFor="add-deviceType" required>
            <Controller
              control={form.control}
              name="deviceType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as DeviceType)}>
                  <SelectTrigger id="add-deviceType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {humanize(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <DepartmentField id="add-departmentId" control={form.control} departments={departments.data} loading={departments.isLoading} />
          <Field label="Manufacturer" htmlFor="add-manufacturer">
            <Input id="add-manufacturer" placeholder="Dell Inc." {...form.register("manufacturer")} />
          </Field>
          <Field label="Model" htmlFor="add-model">
            <Input id="add-model" placeholder="Latitude 7440" {...form.register("model")} />
          </Field>
          <Field label="Purchase date" htmlFor="add-purchaseDate">
            <Input id="add-purchaseDate" type="date" {...form.register("purchaseDate")} />
          </Field>
          <Field label="Warranty expires" htmlFor="add-warrantyExpiresAt">
            <Input id="add-warrantyExpiresAt" type="date" {...form.register("warrantyExpiresAt")} />
          </Field>
          <CompanyOwnedSwitch id="add-isCompanyOwned" control={form.control} className="sm:col-span-2" />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-device-form" loading={mutation.isPending}>
            Add device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small shared controlled fields (generic over the two form shapes that contain them).

type WithDeptAndOwned = { departmentId: string; isCompanyOwned: boolean };

function DepartmentField<T extends WithDeptAndOwned>({
  id,
  control,
  departments,
  loading,
}: {
  id: string;
  control: Control<T>;
  departments: { id: string; name: string }[] | undefined;
  loading: boolean;
}) {
  return (
    <Field label="Department" htmlFor={id}>
      <Controller
        control={control as unknown as Control<WithDeptAndOwned>}
        name="departmentId"
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange} disabled={loading}>
            <SelectTrigger id={id}>
              <SelectValue placeholder={loading ? "Loading…" : "Select department"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No department</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );
}

function CompanyOwnedSwitch<T extends WithDeptAndOwned>({
  id,
  control,
  className,
}: {
  id: string;
  control: Control<T>;
  className?: string;
}) {
  return (
    <Controller
      control={control as unknown as Control<WithDeptAndOwned>}
      name="isCompanyOwned"
      render={({ field }) => (
        <div className={cn("flex items-center justify-between gap-4 rounded-md border px-3 py-2.5", className)}>
          <div>
            <Label htmlFor={id}>Company-owned device</Label>
            <p className="text-xs text-muted-foreground">Personal (BYOD) devices fail the “company data only on managed devices” rule.</p>
          </div>
          <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}

// ───────────────────────────── Edit inventory fields ─────────────────────────────

const editSchema = z.object({
  deviceName: z.string().trim().min(1, "Device name is required").max(128),
  assetId: z.string().trim().max(128),
  deviceType: z.enum(DEVICE_TYPES),
  manufacturer: optionalText,
  model: optionalText,
  departmentId: z.string(),
  groupId: z.string(),
  purchaseDate: z.string().optional(),
  warrantyExpiresAt: z.string().optional(),
  isCompanyOwned: z.boolean(),
  tags: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});
type EditValues = z.infer<typeof editSchema>;

function editDefaults(d: Device): EditValues {
  return {
    deviceName: d.deviceName,
    assetId: d.assetId ?? "",
    deviceType: d.deviceType,
    manufacturer: d.manufacturer ?? "",
    model: d.model ?? "",
    departmentId: d.departmentId ?? NONE,
    groupId: d.groupId ?? NONE,
    purchaseDate: toIsoDateInput(d.purchaseDate),
    warrantyExpiresAt: toIsoDateInput(d.warrantyExpiresAt),
    isCompanyOwned: d.isCompanyOwned,
    tags: (d.tags ?? []).join(", "),
    notes: d.notes ?? "",
  };
}

export function EditDeviceSheet({ device, open, onOpenChange }: { device: Device; open: boolean; onOpenChange: (o: boolean) => void }) {
  const departments = useDepartments(open);
  const groups = useDeviceGroups(open);
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema), defaultValues: editDefaults(device) });

  React.useEffect(() => {
    if (open) form.reset(editDefaults(device));
  }, [open, device, form]);

  const mutation = useApiMutation((body: Record<string, unknown>) => api.patch<Device>(`/devices/${device.id}`, body), {
    success: "Device updated",
    invalidate: [["devices"]],
    onSuccess: () => onOpenChange(false),
  });

  const onSubmit = form.handleSubmit((v) =>
    mutation.mutate({
      deviceName: v.deviceName,
      assetId: v.assetId || undefined,
      deviceType: v.deviceType,
      manufacturer: v.manufacturer || null,
      model: v.model || null,
      departmentId: v.departmentId === NONE ? null : v.departmentId,
      groupId: v.groupId === NONE ? null : v.groupId,
      purchaseDate: toNullableDate(v.purchaseDate),
      warrantyExpiresAt: toNullableDate(v.warrantyExpiresAt),
      isCompanyOwned: v.isCompanyOwned,
      tags: (v.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes: v.notes || null,
    }),
  );

  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit device</SheetTitle>
          <SheetDescription>Inventory fields reported by the agent (CPU, OS, network) are read-only.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="edit-device-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Device name" htmlFor="edit-deviceName" error={errors.deviceName?.message} required className="sm:col-span-2">
              <Input id="edit-deviceName" {...form.register("deviceName")} />
            </Field>
            <Field label="Asset ID" htmlFor="edit-assetId" error={errors.assetId?.message}>
              <Input id="edit-assetId" className="font-mono" {...form.register("assetId")} />
            </Field>
            <Field label="Device type" htmlFor="edit-deviceType">
              <Controller
                control={form.control}
                name="deviceType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as DeviceType)}>
                    <SelectTrigger id="edit-deviceType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEVICE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {humanize(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Manufacturer" htmlFor="edit-manufacturer">
              <Input id="edit-manufacturer" {...form.register("manufacturer")} />
            </Field>
            <Field label="Model" htmlFor="edit-model">
              <Input id="edit-model" {...form.register("model")} />
            </Field>
            <div className="sm:col-span-2">
              <DepartmentField id="edit-departmentId" control={form.control} departments={departments.data} loading={departments.isLoading} />
            </div>
            <Field label="Device group" htmlFor="edit-groupId" className="sm:col-span-2">
              <Controller
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={groups.isLoading}>
                    <SelectTrigger id="edit-groupId">
                      <SelectValue placeholder={groups.isLoading ? "Loading…" : "No group"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No group</SelectItem>
                      {(groups.data ?? []).map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Purchase date" htmlFor="edit-purchaseDate">
              <Input id="edit-purchaseDate" type="date" {...form.register("purchaseDate")} />
            </Field>
            <Field label="Warranty expires" htmlFor="edit-warrantyExpiresAt">
              <Input id="edit-warrantyExpiresAt" type="date" {...form.register("warrantyExpiresAt")} />
            </Field>
            <CompanyOwnedSwitch id="edit-isCompanyOwned" control={form.control} className="sm:col-span-2" />
            <Field label="Tags" htmlFor="edit-tags" hint="Comma separated, e.g. finance, vip, loaner" className="sm:col-span-2">
              <Input id="edit-tags" {...form.register("tags")} />
            </Field>
            <Field label="Notes" htmlFor="edit-notes" className="sm:col-span-2">
              <Textarea id="edit-notes" rows={4} {...form.register("notes")} />
            </Field>
          </form>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-device-form" loading={mutation.isPending}>
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────────── Assign user ─────────────────────────────

export function AssignUserDialog({ device, open, onOpenChange }: { device: Device; open: boolean; onOpenChange: (o: boolean) => void }) {
  const canSearchUsers = usePermission("users:read");
  const [search, setSearch] = React.useState("");
  const debounced = useDebounce(search, 250);
  const [selected, setSelected] = React.useState<{ id: string; displayName: string; email: string } | null>(null);
  const [notes, setNotes] = React.useState("");
  const users = useUserSearch(debounced, open);

  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(null);
      setNotes("");
    }
  }, [open]);

  const assign = useApiMutation((body: { userId: string; notes?: string }) => api.post(`/devices/${device.id}/assign`, body), {
    success: (_d, v) => `Assigned to ${selected?.displayName ?? v.userId}`,
    invalidate: [["devices"]],
    onSuccess: () => onOpenChange(false),
  });
  const unassign = useApiMutation(() => api.post(`/devices/${device.id}/unassign`), {
    success: "Device unassigned",
    invalidate: [["devices"]],
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign user</DialogTitle>
          <DialogDescription>
            {device.assignedUser ? (
              <>
                Currently assigned to <span className="font-medium text-foreground">{device.assignedUser.displayName}</span>. Assigning a new user closes
                the current assignment.
              </>
            ) : (
              "This device is not assigned to anyone."
            )}
          </DialogDescription>
        </DialogHeader>

        {canSearchUsers ? (
          <div className="grid gap-2">
            <Label htmlFor="assign-search">User</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="assign-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" className="pl-8" autoComplete="off" />
              {users.isFetching && <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border scrollbar-thin" role="listbox" aria-label="Users">
              {users.isError ? (
                <p className="p-3 text-xs text-destructive">User search failed.</p>
              ) : (users.data ?? []).length === 0 && !users.isLoading ? (
                <EmptyState compact title="No users found" />
              ) : (
                (users.data ?? []).map((u) => {
                  const active = selected?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelected({ id: u.id, displayName: u.displayName, email: u.email })}
                      className={cn(
                        "flex w-full items-center gap-2.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                        active && "bg-primary/8",
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                        {initials(u.displayName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{u.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email}
                          {u.department?.name ? ` · ${u.department.name}` : ""}
                        </span>
                      </span>
                      {active && <Check className="size-4 text-primary" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Your role cannot search the user directory.</p>
        )}

        <Field label="Notes" htmlFor="assign-notes" hint="Optional — e.g. loaner until repair is complete">
          <Textarea id="assign-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>

        <DialogFooter className="sm:justify-between">
          {device.assignedUserId ? (
            <Button variant="outline" onClick={() => unassign.mutate()} loading={unassign.isPending}>
              <UserMinus /> Unassign
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!selected} loading={assign.isPending} onClick={() => selected && assign.mutate({ userId: selected.id, notes: notes.trim() || undefined })}>
              <UserPlus /> Assign
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Assign policy (bulk) ─────────────────────────────

export function AssignPolicyDialog({
  deviceIds,
  open,
  onOpenChange,
  onDone,
}: {
  deviceIds: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const policies = usePolicies(open);
  const [policyId, setPolicyId] = React.useState<string>("");

  React.useEffect(() => {
    if (open) setPolicyId("");
  }, [open]);

  const mutation = useApiMutation((id: string) => api.post(`/policies/${id}/assign`, { deviceIds }), {
    success: () => {
      const name = policies.data?.find((p) => p.id === policyId)?.name ?? "Policy";
      return `${name} assigned to ${deviceIds.length} device${deviceIds.length === 1 ? "" : "s"}`;
    },
    invalidate: [["devices"], ["policies"], ["compliance"]],
    onSuccess: () => {
      onOpenChange(false);
      onDone?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign policy</DialogTitle>
          <DialogDescription>
            Overrides the department / default policy for {deviceIds.length} selected device{deviceIds.length === 1 ? "" : "s"}. Agents receive the new
            policy on their next check-in.
          </DialogDescription>
        </DialogHeader>
        <Field label="Policy" htmlFor="assign-policy" required>
          <Select value={policyId} onValueChange={setPolicyId} disabled={policies.isLoading}>
            <SelectTrigger id="assign-policy">
              <SelectValue placeholder={policies.isLoading ? "Loading policies…" : "Select a policy"} />
            </SelectTrigger>
            <SelectContent>
              {(policies.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  <span className="ml-1 text-xs text-muted-foreground">v{p.version}{p.isDefault ? " · default" : ""}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {policies.isError && <p className="text-xs text-destructive">Could not load policies.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!policyId} loading={mutation.isPending} onClick={() => mutation.mutate(policyId)}>
            Assign policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
