"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Laptop, Loader2, Moon, Sun, Monitor, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_NAV_ITEMS, isNavVisible, navLabel } from "@/components/layout/nav";
import { useAuth } from "@/lib/auth";
import { useDebounce } from "@/hooks/use-debounce";
import { useDeviceSearch } from "@/hooks/use-lookups";
import { OsIcon } from "@/components/common/os-icon";
import { ComplianceBadge } from "@/components/common/status-badges";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { can, user, logout } = useAuth();
  const { setTheme } = useTheme();
  const [search, setSearch] = React.useState("");
  const debounced = useDebounce(search.trim(), 250);
  const canDevices = can("devices:read");
  const devices = useDeviceSearch(debounced, open && canDevices && debounced.length >= 2);

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const q = search.trim().toLowerCase();
  const pages = ALL_NAV_ITEMS.filter((i) => isNavVisible(i, (p) => can(p), user?.role)).filter((i) => {
    if (!q) return true;
    const hay = [navLabel(i, user?.role), i.title, ...(i.keywords ?? [])].join(" ").toLowerCase();
    return hay.includes(q);
  });

  const deviceRows = debounced.length >= 2 ? (devices.data ?? []) : [];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput value={search} onValueChange={setSearch} placeholder={canDevices ? "Search pages or devices by name…" : "Search pages…"} />
      <CommandList>
        {pages.length === 0 && deviceRows.length === 0 && !devices.isFetching && <CommandEmpty>No results found.</CommandEmpty>}
        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.map((p) => (
              <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                <p.icon />
                <span>{navLabel(p, user?.role)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {canDevices && debounced.length >= 2 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Devices">
              {devices.isFetching && deviceRows.length === 0 && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Searching devices…
                </div>
              )}
              {devices.isError && <div className="px-2 py-3 text-xs text-destructive">Device search is unavailable right now.</div>}
              {!devices.isFetching && !devices.isError && deviceRows.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground">No devices match “{debounced}”.</div>
              )}
              {deviceRows.map((d) => (
                <CommandItem key={d.id} value={`device-${d.id}`} onSelect={() => go(`/devices/${d.id}`)}>
                  <OsIcon platform={d.platform} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{d.deviceName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {d.serialNumber} · {d.assignedUser?.displayName ?? "Unassigned"}
                    </div>
                  </div>
                  <ComplianceBadge value={d.complianceState} />
                </CommandItem>
              ))}
              {deviceRows.length > 0 && (
                <CommandItem value="device-all" onSelect={() => go(`/devices?search=${encodeURIComponent(debounced)}`)}>
                  <Laptop />
                  <span>See all device results for “{debounced}”</span>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}
        {!q && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Preferences">
              <CommandItem value="theme-light" onSelect={() => { setTheme("light"); onOpenChange(false); }}>
                <Sun /> Light theme
              </CommandItem>
              <CommandItem value="theme-dark" onSelect={() => { setTheme("dark"); onOpenChange(false); }}>
                <Moon /> Dark theme
              </CommandItem>
              <CommandItem value="theme-system" onSelect={() => { setTheme("system"); onOpenChange(false); }}>
                <Monitor /> System theme
              </CommandItem>
              <CommandItem value="logout" onSelect={() => { onOpenChange(false); void logout(); }}>
                <LogOut /> Sign out
                <CommandShortcut />
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
