"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { DeviceGroup, DeviceGroupInput } from "@/types/api";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color like #2563eb")
    .optional()
    .or(z.literal("")),
});
type Values = z.infer<typeof schema>;

export function DeviceGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  /** null = create */
  group: DeviceGroup | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-primary" /> {group ? "Edit device group" : "New device group"}
          </DialogTitle>
          <DialogDescription>Groups organize devices for filtering and bulk operations. A device belongs to at most one group.</DialogDescription>
        </DialogHeader>
        <DeviceGroupForm key={group?.id ?? "new"} group={group} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DeviceGroupForm({ group, onDone }: { group: DeviceGroup | null; onDone: () => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: group?.name ?? "", description: group?.description ?? "", color: group?.color ?? "" },
  });
  const { register, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useApiMutation(
    (input: DeviceGroupInput) => (group ? api.patch<DeviceGroup>(`/device-groups/${group.id}`, input) : api.post<DeviceGroup>("/device-groups", input)),
    {
      success: (_d, v) => (group ? `Group ${v.name} updated` : `Group ${v.name} created`),
      invalidate: [["device-groups"], ["devices"]],
      onSuccess: onDone,
    },
  );

  const onSubmit = handleSubmit((v) =>
    save.mutate({ name: v.name, description: v.description || null, color: v.color || null }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field label="Name" htmlFor="dg-name" required error={errors.name?.message}>
        <Input id="dg-name" {...register("name")} aria-invalid={!!errors.name} placeholder="Delhi Office Laptops" />
      </Field>
      <Field label="Description" htmlFor="dg-desc" error={errors.description?.message}>
        <Textarea id="dg-desc" rows={2} {...register("description")} />
      </Field>
      <Field label="Color" htmlFor="dg-color" error={errors.color?.message} hint="Optional hex color for the badge">
        <Input id="dg-color" {...register("color")} placeholder="#2563eb" className="font-mono" />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {group ? "Save changes" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  );
}
