"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

/** Compact filter chip: "Platform: All ▾". Value "all" (or undefined) means no filter. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: FilterOption[];
  allLabel?: string;
  className?: string;
}) {
  const active = value !== undefined && value !== "" && value !== "all";
  return (
    <Select value={active ? value : "all"} onValueChange={(v) => onChange(v === "all" ? undefined : v)}>
      <SelectTrigger
        size="sm"
        aria-label={`Filter by ${label}`}
        className={cn(
          "h-8 w-auto min-w-0 gap-1 rounded-md border-dashed px-2.5 text-xs",
          active && "border-solid border-primary/50 bg-primary/5 text-foreground",
          className,
        )}
      >
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[10rem]">
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ClearFiltersButton({ count, onClear }: { count: number; onClear: () => void }) {
  if (count <= 0) return null;
  return (
    <Button variant="ghost" size="xs" onClick={onClear} className="text-muted-foreground">
      <X /> Reset ({count})
    </Button>
  );
}

export function DateRangeFilter({
  from,
  to,
  onChange,
  className,
}: {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Input
        type="date"
        aria-label="From date"
        value={from ?? ""}
        onChange={(e) => onChange({ from: e.target.value || undefined, to })}
        className="h-8 w-[138px] px-2 text-xs"
      />
      <span className="text-xs text-muted-foreground">–</span>
      <Input
        type="date"
        aria-label="To date"
        value={to ?? ""}
        onChange={(e) => onChange({ from, to: e.target.value || undefined })}
        className="h-8 w-[138px] px-2 text-xs"
      />
    </div>
  );
}

/** Build FilterOption[] from an enum array + label map / humanizer. */
export function enumOptions<T extends string>(values: readonly T[], label: (v: T) => string): FilterOption[] {
  return values.map((v) => ({ value: v, label: label(v) }));
}

export function useDateParam(value: string | undefined, endOfDay = false): string | undefined {
  return React.useMemo(() => {
    if (!value) return undefined;
    return endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  }, [value, endOfDay]);
}
