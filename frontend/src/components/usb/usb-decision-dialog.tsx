"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, KeyValueGrid } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import { USB_DURATION_OPTIONS, VidPid, durationLabel } from "@/components/usb/usb-utils";
import type { UsbAccessRequest } from "@/types/api";

/** Approve (with optional duration override) or deny a temporary USB access request. */
export function UsbDecisionDialog({
  request,
  mode,
  onClose,
}: {
  request: UsbAccessRequest | null;
  mode: "approve" | "deny";
  onClose: () => void;
}) {
  const open = !!request;
  const [duration, setDuration] = React.useState<number>(4);
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (request) {
      setDuration(request.durationHours);
      setNote("");
      setNoteError(undefined);
    }
  }, [request]);

  const durations = React.useMemo(
    () => Array.from(new Set([...USB_DURATION_OPTIONS, request?.durationHours ?? 4])).filter((h) => h >= 1 && h <= 72).sort((a, b) => a - b),
    [request],
  );

  const approve = useApiMutation(
    (v: { id: string; note?: string; durationHours?: number }) =>
      api.post<UsbAccessRequest>(`/usb/requests/${v.id}/approve`, { note: v.note, durationHours: v.durationHours }),
    { success: "Access approved — the endpoint will receive updated USB rules", invalidate: [["usb"]], onSuccess: onClose },
  );
  const deny = useApiMutation((v: { id: string; note: string }) => api.post<UsbAccessRequest>(`/usb/requests/${v.id}/deny`, { note: v.note }), {
    success: "Request denied",
    invalidate: [["usb"]],
    onSuccess: onClose,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    const trimmed = note.trim();
    if (mode === "deny") {
      if (trimmed.length < 3) {
        setNoteError("Explain why the request is denied — the requester will see this note");
        return;
      }
      deny.mutate({ id: request.id, note: trimmed });
    } else {
      approve.mutate({
        id: request.id,
        note: trimmed || undefined,
        durationHours: duration !== request.durationHours ? duration : undefined,
      });
    }
  };

  const pending = approve.isPending || deny.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "approve" ? "Approve USB access" : "Deny USB access"}</DialogTitle>
          <DialogDescription>
            {mode === "approve"
              ? "Access starts immediately and expires automatically. The endpoint is told to refresh its USB rules."
              : "The requester is notified and the device stays blocked."}
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="rounded-md border bg-muted/30 p-3">
            <KeyValueGrid
              items={[
                { label: "Requester", value: request.requester?.displayName ?? request.requesterId },
                { label: "Endpoint", value: request.device?.deviceName ?? request.deviceId },
                { label: "USB device", value: <VidPid vendorId={request.vendorId} productId={request.productId} /> },
                { label: "Serial", value: request.serialNumber || "Any unit", mono: !!request.serialNumber },
                { label: "Requested for", value: durationLabel(request.durationHours) },
                { label: "Access", value: request.readOnly ? "Read-only" : "Read / write" },
              ]}
            />
            <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Reason: </span>
              {request.reason}
            </p>
          </div>
        )}
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {mode === "approve" && (
            <Field label="Access duration" htmlFor="usb-approve-duration" hint="Override the requested duration if needed (1–72 hours)">
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger id="usb-approve-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durations.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {durationLabel(h)}
                      {h === request?.durationHours ? " (requested)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field
            label={mode === "approve" ? "Note" : "Reason for denial"}
            htmlFor="usb-decision-note"
            error={noteError}
            hint={mode === "approve" ? "Optional — visible to the requester" : undefined}
            required={mode === "deny"}
          >
            <Textarea
              id="usb-decision-note"
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (noteError) setNoteError(undefined);
              }}
              maxLength={1000}
              aria-invalid={!!noteError || undefined}
              placeholder={mode === "approve" ? "e.g. Approved for the quarterly audit export" : "e.g. Use the corporate file share instead"}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={mode === "deny" ? "destructive" : "default"} loading={pending}>
              {mode === "approve" ? "Approve access" : "Deny request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
