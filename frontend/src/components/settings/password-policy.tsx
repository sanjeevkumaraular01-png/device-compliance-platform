"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Server password policy (docs/API.md): ≥ 12 chars, upper, lower, digit, symbol. */
export const PASSWORD_RULES: { key: string; label: string; test: (v: string) => boolean }[] = [
  { key: "length", label: "At least 12 characters", test: (v) => v.length >= 12 },
  { key: "upper", label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { key: "lower", label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { key: "digit", label: "A number", test: (v) => /\d/.test(v) },
  { key: "symbol", label: "A symbol (e.g. ! @ # $)", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function isStrongPassword(value: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(value));
}

export const PASSWORD_POLICY_MESSAGE = "Password does not meet the policy requirements";

/** Live checklist rendered under a password input. */
export function PasswordChecklist({ value, className }: { value: string; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2", className)} aria-label="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.key} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-sev-none" : "text-muted-foreground")}>
            {ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <X className="size-3.5 shrink-0 opacity-60" aria-hidden />}
            <span>{r.label}</span>
            <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
