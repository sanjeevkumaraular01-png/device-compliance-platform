import { TASK_PRIORITIES, type TaskImportItem, type TaskPriority } from "@/types/api";

/**
 * RFC 4180-style CSV parser: comma or semicolon/tab delimiter (auto-detected from the header line),
 * double-quoted fields with "" escapes, quoted newlines, CRLF/LF line endings, BOM stripped.
 * Returns rows of raw string cells; fully empty lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].reduce((best, d) => (countOutsideQuotes(firstLine, d) > countOutsideQuotes(firstLine, best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const pushRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
    cell = "";
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
      i++;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      pushRow();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== "" || row.length) pushRow();
  return rows;
}

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ch && !q) n++;
  }
  return n;
}

export const IMPORT_COLUMNS = ["externalRef", "title", "description", "assigneeEmail", "projectCode", "estimatedMinutes", "dueDate", "priority"] as const;
type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Header aliases (lower-cased, non-alphanumerics removed) → canonical column. */
const ALIASES: Record<string, ImportColumn> = {
  externalref: "externalRef",
  ref: "externalRef",
  id: "externalRef",
  externalid: "externalRef",
  title: "title",
  name: "title",
  subject: "title",
  description: "description",
  details: "description",
  assigneeemail: "assigneeEmail",
  assignee: "assigneeEmail",
  email: "assigneeEmail",
  projectcode: "projectCode",
  project: "projectCode",
  estimatedminutes: "estimatedMinutes",
  estimate: "estimatedMinutes",
  estimateminutes: "estimatedMinutes",
  minutes: "estimatedMinutes",
  duedate: "dueDate",
  due: "dueDate",
  priority: "priority",
};

export interface ParsedImportRow {
  line: number;
  item: TaskImportItem;
  errors: string[];
}

export interface ParseResult {
  format: "csv" | "json" | null;
  rows: ParsedImportRow[];
  /** Problems with the input as a whole (bad JSON, missing header columns…). */
  fatal: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeItem(raw: Record<string, unknown>, line: number): ParsedImportRow {
  const errors: string[] = [];
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
  const item: TaskImportItem = { externalRef: str(raw.externalRef), title: str(raw.title) };
  if (!item.externalRef) errors.push("externalRef is required");
  if (!item.title) errors.push("title is required");
  const description = str(raw.description);
  if (description) item.description = description;
  const assigneeEmail = str(raw.assigneeEmail);
  if (assigneeEmail) {
    if (!EMAIL_RE.test(assigneeEmail)) errors.push(`assigneeEmail “${assigneeEmail}” is not a valid email`);
    item.assigneeEmail = assigneeEmail.toLowerCase();
  }
  const projectCode = str(raw.projectCode);
  if (projectCode) item.projectCode = projectCode.toUpperCase();
  const est = str(raw.estimatedMinutes);
  if (est) {
    const n = Number(est);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) errors.push(`estimatedMinutes “${est}” must be a whole number`);
    else item.estimatedMinutes = n;
  }
  const due = str(raw.dueDate);
  if (due) {
    if (Number.isNaN(Date.parse(due))) errors.push(`dueDate “${due}” is not a date (use YYYY-MM-DD)`);
    else item.dueDate = due;
  }
  const pr = str(raw.priority).toUpperCase();
  if (pr) {
    if ((TASK_PRIORITIES as readonly string[]).includes(pr)) item.priority = pr as TaskPriority;
    else errors.push(`priority “${pr}” must be one of ${TASK_PRIORITIES.join(", ")}`);
  }
  return { line, item, errors };
}

/** Accepts a JSON array of items (or `{ items: [...] }`) or CSV with a header row. */
export function parseImport(text: string): ParseResult {
  const t = text.trim();
  if (!t) return { format: null, rows: [], fatal: null };
  if (t.startsWith("[") || t.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(t);
    } catch (e) {
      return { format: "json", rows: [], fatal: `Invalid JSON: ${e instanceof Error ? e.message : "parse error"}` };
    }
    const arr = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : null;
    if (!arr) return { format: "json", rows: [], fatal: "JSON must be an array of task objects (or { \"items\": [...] })" };
    return {
      format: "json",
      rows: arr.map((o, i) =>
        o && typeof o === "object" && !Array.isArray(o)
          ? normalizeItem(o as Record<string, unknown>, i + 1)
          : { line: i + 1, item: { externalRef: "", title: "" }, errors: ["Entry is not an object"] },
      ),
      fatal: null,
    };
  }
  const table = parseCsv(t);
  if (table.length === 0) return { format: "csv", rows: [], fatal: null };
  const header = table[0].map((h) => ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null);
  const missing = (["externalRef", "title"] as const).filter((c) => !header.includes(c));
  if (missing.length) {
    return { format: "csv", rows: [], fatal: `Header row must include ${missing.join(" and ")} (expected: ${IMPORT_COLUMNS.join(",")})` };
  }
  const rows = table.slice(1).map((cells, i) => {
    const raw: Record<string, unknown> = {};
    header.forEach((col, j) => {
      if (col && raw[col] === undefined) raw[col] = cells[j] ?? "";
    });
    return normalizeItem(raw, i + 2);
  });
  return { format: "csv", rows, fatal: null };
}

/** Flags duplicate externalRefs in the batch (the server upserts by (source, externalRef)). */
export function markDuplicates(rows: ParsedImportRow[]): ParsedImportRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const ref = r.item.externalRef;
    if (!ref) return r;
    const first = seen.get(ref);
    if (first === undefined) {
      seen.set(ref, r.line);
      return r;
    }
    return { ...r, errors: [...r.errors, `duplicate externalRef (also on line ${first})`] };
  });
}
