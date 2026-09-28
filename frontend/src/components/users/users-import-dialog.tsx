"use client";

import * as React from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/misc";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { RoleKey } from "@/types/api";

interface ImportRow {
  email: string;
  displayName: string;
  employeeCode?: string;
  department?: string;
  jobTitle?: string;
  location?: string;
  roleKey?: RoleKey;
  managerEmail?: string;
}
interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { email: string; error: string }[];
}

const TEMPLATE = "email,displayName,employeeCode,department,jobTitle,location,managerEmail\njane@webyne.com,Jane Doe,CSS0001,Sales,Sales Executive,Delhi NCR,manager@webyne.com\n";

// Minimal CSV parser: handles quoted fields, commas and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  email: "email",
  "e-mail": "email",
  "email address": "email",
  name: "displayName",
  displayname: "displayName",
  "full name": "displayName",
  "employee name": "displayName",
  employeecode: "employeeCode",
  "employee code": "employeeCode",
  "employee id": "employeeCode",
  "emp id": "employeeCode",
  empid: "employeeCode",
  "staff id": "employeeCode",
  department: "department",
  dept: "department",
  jobtitle: "jobTitle",
  "job title": "jobTitle",
  designation: "jobTitle",
  title: "jobTitle",
  location: "location",
  city: "location",
  office: "location",
  role: "roleKey",
  rolekey: "roleKey",
  manager: "managerEmail",
  manageremail: "managerEmail",
  "manager email": "managerEmail",
  "reporting manager": "managerEmail",
};

function rowsFromCsv(text: string): { rows: ImportRow[]; error?: string } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], error: "Need a header row and at least one data row." };
  const headers = grid[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()]);
  if (!headers.includes("email") || !headers.includes("displayName")) {
    return { rows: [], error: "CSV must have at least 'email' and 'displayName' (or 'name') columns." };
  }
  const out: ImportRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const obj: Record<string, string> = {};
    headers.forEach((key, i) => {
      if (key && cells[i] != null) obj[key] = cells[i].trim();
    });
    if (!obj.email) continue;
    const row: ImportRow = { email: obj.email, displayName: obj.displayName || obj.email.split("@")[0] };
    if (obj.employeeCode) row.employeeCode = obj.employeeCode;
    if (obj.department) row.department = obj.department;
    if (obj.jobTitle) row.jobTitle = obj.jobTitle;
    if (obj.location) row.location = obj.location;
    if (obj.managerEmail) row.managerEmail = obj.managerEmail;
    if (obj.roleKey) row.roleKey = obj.roleKey.toUpperCase().replace(/\s+/g, "_") as RoleKey;
    out.push(row);
  }
  return { rows: out };
}

export function UsersImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = React.useState("");
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  const parsed = React.useMemo(() => (text.trim() ? rowsFromCsv(text) : { rows: [] as ImportRow[] }), [text]);

  const importMut = useApiMutation((rows: ImportRow[]) => api.post<ImportResult>("/users/import", { rows }), {
    success: (r) => `Import complete: ${r?.created ?? 0} created, ${r?.updated ?? 0} updated`,
    invalidate: [["users"], ["departments"]],
    onSuccess: (r) => setResult(r ?? null),
  });

  const onFile = async (file: File) => {
    const content = await file.text();
    setText(content);
    setResult(null);
  };

  const onSubmit = () => {
    setParseError(null);
    setResult(null);
    const { rows, error } = rowsFromCsv(text);
    if (error) {
      setParseError(error);
      return;
    }
    if (!rows.length) {
      setParseError("No rows to import.");
      return;
    }
    importMut.mutate(rows);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(() => {
      setText("");
      setParseError(null);
      setResult(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" /> Import employees from CSV
          </DialogTitle>
          <DialogDescription>
            Upload or paste a CSV exported from your HR system. Rows are matched by email — existing users are updated, new ones are created (role Employee
            unless a role is given).
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-3">
                <div className="text-2xl font-semibold text-emerald-600">{result.created}</div>
                <div className="text-xs text-muted-foreground">Created</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-2xl font-semibold text-blue-600">{result.updated}</div>
                <div className="text-xs text-muted-foreground">Updated</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-2xl font-semibold text-muted-foreground">{result.skipped}</div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <div className="mb-1 font-medium text-destructive">{result.errors.length} row(s) failed:</div>
                <ul className="grid gap-0.5">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono">{e.email}</span> — {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>
                Import more
              </Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <label className="cursor-pointer">
                  <Upload /> Choose CSV file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
                <Download /> Template
              </Button>
            </div>
            <Field label="…or paste CSV" htmlFor="csv-text" error={parseError ?? undefined}>
              <Textarea
                id="csv-text"
                rows={8}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setParseError(null);
                }}
                placeholder={TEMPLATE}
                className="font-mono text-xs"
              />
            </Field>
            {text.trim() && !parsed.error && (
              <p className="text-xs text-muted-foreground">{parsed.rows.length} employee row(s) detected.</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={onSubmit} loading={importMut.isPending} disabled={!parsed.rows.length}>
                Import {parsed.rows.length || ""} employees
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
