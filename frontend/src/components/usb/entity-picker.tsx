"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface PickerItem {
  id: string;
  label: string;
  sub?: string;
}

/** Server-searched single-select combobox (users / devices). */
export function EntityPicker({
  id,
  value,
  selectedLabel,
  onChange,
  items,
  loading,
  search,
  onSearchChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  invalid,
}: {
  id?: string;
  value: string | undefined;
  selectedLabel?: string;
  onChange: (item: PickerItem) => void;
  items: PickerItem[];
  loading?: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const current = items.find((i) => i.id === value);
  const label = current?.label ?? selectedLabel;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          <span className="truncate">{value ? (label ?? value) : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[16rem] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={onSearchChange} placeholder={searchPlaceholder} className="h-9" />
          <CommandList className="max-h-64">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {items.map((it) => (
                    <CommandItem
                      key={it.id}
                      value={it.id}
                      onSelect={() => {
                        onChange(it);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("size-3.5", it.id === value ? "opacity-100" : "opacity-0")} />
                      <div className="min-w-0">
                        <div className="truncate text-sm">{it.label}</div>
                        {it.sub && <div className="truncate text-xs text-muted-foreground">{it.sub}</div>}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
