"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useUserSearch } from "@/hooks/use-lookups";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import type { User } from "@/types/api";

export interface UserPickerProps {
  id?: string;
  value: string | undefined | null;
  onChange: (userId: string | undefined, user?: User) => void;
  /** Label to show for the current value when it is not in the loaded search results. */
  selectedLabel?: string | null;
  placeholder?: string;
  size?: "default" | "sm";
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  "aria-label"?: string;
}

/** Searchable user combobox backed by `GET /users?search=`. */
export function UserPicker({
  id,
  value,
  onChange,
  selectedLabel,
  placeholder = "Select a user…",
  size = "default",
  className,
  disabled,
  clearable = true,
  "aria-label": ariaLabel,
}: UserPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const debounced = useDebounce(search, 250);
  const users = useUserSearch(debounced, open);
  const [picked, setPicked] = React.useState<User | null>(null);

  const current = value ? (picked?.id === value ? picked : users.data?.find((u) => u.id === value)) : undefined;
  const label = value ? (current?.displayName ?? selectedLabel ?? "Selected user") : null;

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "w-full min-w-0 justify-between font-normal",
              size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3",
              !label && "text-muted-foreground",
            )}
          >
            <span className="truncate">{label ?? placeholder}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} placeholder="Search name or email…" />
            <CommandList>
              {users.isFetching && !users.data ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Searching…
                </div>
              ) : (
                <CommandEmpty>{users.isError ? "Could not load users" : "No users found"}</CommandEmpty>
              )}
              <CommandGroup>
                {(users.data ?? []).map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.id}
                    onSelect={() => {
                      setPicked(u);
                      onChange(u.id, u);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{u.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <Check className={cn("size-4", value === u.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {clearable && value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size={size === "sm" ? "icon-xs" : "icon-sm"}
          aria-label="Clear user"
          onClick={() => {
            setPicked(null);
            onChange(undefined);
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
