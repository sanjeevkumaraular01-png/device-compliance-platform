"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { DevicePolicy } from "@/types/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function PolicyRowActions({
  policy,
  canWrite,
  onOpen,
  onDelete,
}: {
  policy: DevicePolicy;
  canWrite: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    // Stop propagation so menu clicks (bubbling through the portal) don't trigger the row click.
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${policy.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={onOpen}>
            <Pencil /> {canWrite ? "Edit policy" : "View policy"}
          </DropdownMenuItem>
          {canWrite && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive disabled={policy.isDefault} onSelect={onDelete}>
                <Trash2 /> {policy.isDefault ? "Default policy can’t be deleted" : "Delete policy"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
