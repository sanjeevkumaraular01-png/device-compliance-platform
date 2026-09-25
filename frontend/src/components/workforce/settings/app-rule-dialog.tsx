"use client";

import * as React from "react";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useDepartments } from "@/hooks/use-lookups";
import { api } from "@/lib/api";
import { categoryMeta } from "@/lib/status";
import { ACTIVITY_CATEGORIES, APP_RULE_KINDS, MATCH_TYPES, type AppRule, type AppRuleInput } from "@/types/api";

const GLOBAL = "__global";

export const KIND_LABEL: Record<AppRuleInput["kind"], string> = { APP: "Application", WEBSITE: "Website" };
export const MATCH_LABEL: Record<AppRuleInput["matchType"], string> = { EXACT: "Exact", CONTAINS: "Contains", REGEX: "Regex" };

/** Invalidated after any rule change (rules list + uncategorized queue + usage views). */
export const APP_RULE_INVALIDATE = [["workforce", "app-rules"], ["workforce", "uncategorized"]];

export function AppRuleDialog({
  open,
  onOpenChange,
  rule,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Existing rule to edit; null = create. */
  rule: AppRule | null;
  /** Prefill for a new rule (e.g. from the uncategorized queue). */
  initial?: Partial<AppRuleInput>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="size-4 text-primary" /> {rule ? "Edit category rule" : "New category rule"}
          </DialogTitle>
          <DialogDescription>Classifies matching apps or website domains as productive, neutral, unproductive or blocked.</DialogDescription>
        </DialogHeader>
        {open && <RuleForm key={rule?.id ?? `new-${initial?.pattern ?? ""}`} rule={rule} initial={initial} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function validate(v: AppRuleInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const pat = v.pattern.trim();
  if (!pat) errors.pattern = "Pattern is required";
  else if (pat.length > 255) errors.pattern = "Max 255 characters";
  else if (v.matchType === "REGEX") {
    try {
      new RegExp(pat);
    } catch {
      errors.pattern = "Invalid regular expression";
    }
  } else if (v.kind === "WEBSITE" && /[/?#]|^https?:/i.test(pat)) {
    errors.pattern = "Websites match on the domain only — remove the scheme and path";
  }
  if (v.label.trim().length > 120) errors.label = "Max 120 characters";
  return errors;
}

function RuleForm({ rule, initial, onDone }: { rule: AppRule | null; initial?: Partial<AppRuleInput>; onDone: () => void }) {
  const deps = useDepartments();
  const [v, setV] = React.useState<AppRuleInput>(() => ({
    kind: rule?.kind ?? initial?.kind ?? "APP",
    pattern: rule?.pattern ?? initial?.pattern ?? "",
    matchType: rule?.matchType ?? initial?.matchType ?? "CONTAINS",
    label: rule?.label ?? initial?.label ?? "",
    category: rule?.category ?? initial?.category ?? "PRODUCTIVE",
    departmentId: rule?.departmentId ?? initial?.departmentId ?? null,
  }));
  const [submitted, setSubmitted] = React.useState(false);
  const set = <K extends keyof AppRuleInput>(k: K, val: AppRuleInput[K]) => setV((p) => ({ ...p, [k]: val }));

  const errors = submitted ? validate(v) : {};

  const save = useApiMutation(
    (body: AppRuleInput) => (rule ? api.patch<AppRule>(`/workforce/app-rules/${rule.id}`, body) : api.post<AppRule>("/workforce/app-rules", body)),
    {
      success: (_r, b) => `${b.label} → ${categoryMeta[b.category].label}`,
      invalidate: APP_RULE_INVALIDATE,
      onSuccess: onDone,
    },
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(validate(v)).length > 0) return;
    const pat = v.pattern.trim();
    save.mutate({ ...v, pattern: pat, label: v.label.trim() || pat, departmentId: v.departmentId || null });
  };

  const depKnown = !v.departmentId || deps.data?.some((d) => d.id === v.departmentId);

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor="rule-kind">
          <Select value={v.kind} onValueChange={(k) => set("kind", k as AppRuleInput["kind"])}>
            <SelectTrigger id="rule-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_RULE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Match type" htmlFor="rule-match">
          <Select value={v.matchType} onValueChange={(m) => set("matchType", m as AppRuleInput["matchType"])}>
            <SelectTrigger id="rule-match">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATCH_TYPES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MATCH_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field
        label="Pattern"
        htmlFor="rule-pattern"
        required
        error={errors.pattern}
        hint={v.kind === "WEBSITE" ? "Domain, e.g. github.com (never a full URL)." : "Process or application name, e.g. code or Visual Studio Code."}
      >
        <Input
          id="rule-pattern"
          value={v.pattern}
          onChange={(e) => set("pattern", e.target.value)}
          aria-invalid={!!errors.pattern}
          className="font-mono text-xs"
          placeholder={v.kind === "WEBSITE" ? "github.com" : "code"}
        />
      </Field>
      <Field label="Label" htmlFor="rule-label" error={errors.label} hint="Display name in reports. Defaults to the pattern.">
        <Input id="rule-label" value={v.label} onChange={(e) => set("label", e.target.value)} aria-invalid={!!errors.label} placeholder="VS Code" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor="rule-category">
          <Select value={v.category} onValueChange={(c) => set("category", c as AppRuleInput["category"])}>
            <SelectTrigger id="rule-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {categoryMeta[c].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Department" htmlFor="rule-dept" hint="A department rule overrides the global rule.">
          <Select value={v.departmentId ?? GLOBAL} onValueChange={(d) => set("departmentId", d === GLOBAL ? null : d)}>
            <SelectTrigger id="rule-dept">
              <SelectValue placeholder={deps.isLoading ? "Loading…" : undefined} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL}>All departments (global)</SelectItem>
              {(deps.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
              {!depKnown && v.departmentId && <SelectItem value={v.departmentId}>{rule?.department?.name ?? "Current department"}</SelectItem>}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {rule ? "Save rule" : "Create rule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
