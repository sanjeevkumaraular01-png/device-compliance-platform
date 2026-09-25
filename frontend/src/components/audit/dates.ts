import { toIsoDateInput } from "@/lib/format";

/** "yyyy-MM-dd" from a date input (local time) → ISO timestamp at start / end of that local day. */
export function dateInputToIso(value: string | undefined, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** ISO timestamp (or undefined filter value) → "yyyy-MM-dd" for a date input. */
export function isoToDateInput(value: unknown): string | undefined {
  return typeof value === "string" && value ? toIsoDateInput(value) || undefined : undefined;
}
