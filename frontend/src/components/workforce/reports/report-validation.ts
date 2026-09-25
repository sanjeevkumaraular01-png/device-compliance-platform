import { ApiError } from "@/lib/api";
import type { TaskStatus } from "@/types/api";

/** Editable fields of a report item (keys match `DailyReportItemInput`, except minutes). */
export const ITEM_FIELDS = [
  "taskTitle",
  "projectName",
  "workCompleted",
  "result",
  "pendingWork",
  "blocker",
  "nextAction",
  "evidenceUrl",
  "minutesSpent",
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

export const FIELD_LABELS: Record<ItemField, string> = {
  taskTitle: "Task",
  projectName: "Project",
  workCompleted: "Work completed",
  result: "Result",
  pendingWork: "Pending work",
  blocker: "Blocker",
  nextAction: "Next action",
  evidenceUrl: "Evidence / link",
  minutesSpent: "Minutes",
};

/** Per-field messages; `_item` holds item-level messages not tied to a field. */
export type ItemErrors = Partial<Record<ItemField | "_item", string[]>>;
export interface ReportErrors {
  top: string[];
  items: Record<number, ItemErrors>;
}

export const emptyErrors = (): ReportErrors => ({ top: [], items: {} });

export function errorCount(e: ReportErrors): number {
  return e.top.length + Object.values(e.items).reduce((n, it) => n + Object.values(it).reduce((m, arr) => m + (arr?.length ?? 0), 0), 0);
}

function add(e: ReportErrors, index: number, field: ItemField | "_item", msg: string) {
  const it = (e.items[index] ??= {});
  const arr = (it[field] ??= []);
  if (!arr.includes(msg)) arr.push(msg);
}

// ───────────────────────── Client-side mirror of the server submit rules ─────────────────────────
// Keep in sync with backend/src/daily-reports/validation.ts (MIN_WORK_COMPLETED_CHARS, isVague).

export const MIN_WORK_COMPLETED_CHARS = 15;

const GENERIC_PHRASES = [
  "working on", "worked on", "work on", "same as yesterday", "as usual", "as discussed", "in progress", "follow up", "followed up",
  "looked into", "look into", "checked", "check", "will do", "to do", "n/a", "na", "nil", "none", "nothing", "etc",
];
const GENERIC_WORDS = new Set([
  "work", "worked", "working", "works", "done", "did", "doing", "do", "misc", "miscellaneous", "various", "stuff", "things", "thing",
  "task", "tasks", "general", "some", "many", "all", "the", "a", "an", "and", "or", "on", "in", "of", "to", "for", "with", "it", "its",
  "my", "our", "was", "were", "is", "are", "be", "been", "continued", "continue", "continuing", "ongoing", "update", "updates",
  "updated", "meeting", "meetings", "call", "calls", "daily", "regular", "routine", "usual", "progress", "completed", "complete",
  "finished", "finish", "today", "yesterday", "same", "other", "others", "stuffs", "job", "jobs", "activity", "activities", "also",
  "more", "lot", "lots", "etc", "misc.", "na", "ok", "okay", "fine", "good", "as", "per", "at", "from", "by", "this", "that",
]);

/** True when the text is only generic filler ("working on tasks", "done", "misc stuff"). */
export function isVague(text: string | null | undefined): boolean {
  let t = (text ?? "").toLowerCase().trim();
  if (!t) return true;
  for (const p of GENERIC_PHRASES) t = t.split(p).join(" ");
  const words = t
    .replace(/[^\p{L}\p{N}#\-_/.]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-_/]+|[.\-_/]+$/g, ""))
    .filter(Boolean);
  const meaningful = new Set(words.filter((w) => !GENERIC_WORDS.has(w) && (w.length >= 3 || /\d/.test(w))));
  return meaningful.size < 2;
}

export interface ValidatableItem {
  taskId: string | null;
  taskTitle: string;
  workCompleted: string;
  result: string;
  blocker: string;
  nextAction: string;
  evidenceUrl: string;
  minutes: string;
}

export function validateItems(items: ValidatableItem[], taskStatus: (taskId: string) => TaskStatus | undefined): ReportErrors {
  const e = emptyErrors();
  if (items.length === 0) e.top.push("Add at least one work item before submitting.");
  items.forEach((it, i) => {
    if (!it.taskTitle.trim()) add(e, i, "taskTitle", "Task is required.");
    const wc = it.workCompleted.trim();
    if (!wc) add(e, i, "workCompleted", "Describe the work you completed.");
    else if (wc.length < MIN_WORK_COMPLETED_CHARS) add(e, i, "workCompleted", `At least ${MIN_WORK_COMPLETED_CHARS} characters (${wc.length} now).`);
    else if (isVague(wc)) add(e, i, "workCompleted", "Too vague — describe the concrete work (e.g. “Fixed pagination bug in devices API, added tests”).");
    if (!it.result.trim()) add(e, i, "result", "Result is required.");
    if (it.taskId && taskStatus(it.taskId) !== "DONE" && !it.blocker.trim() && !it.nextAction.trim()) {
      const msg = "The linked task is not done — add a blocker or a next action.";
      add(e, i, "blocker", msg);
      add(e, i, "nextAction", msg);
    }
    const url = it.evidenceUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) add(e, i, "evidenceUrl", "Use a full http(s):// link.");
    const m = it.minutes.trim();
    if (m && (!/^\d+$/.test(m) || Number(m) > 1440)) add(e, i, "minutesSpent", "Whole minutes between 0 and 1440.");
  });
  return e;
}

// ───────────────────────── Server 422 parsing ─────────────────────────
/*
 * Maps a submit/save error to per-item, per-field messages. The API's global exception filter
 * returns `{ statusCode, error, message }` where `message` is a string or string[]; the current
 * backend (daily-reports/validation.ts) emits entries like "Item 3: workCompleted must be …".
 * To stay robust against other shapes we accept, in order:
 *   1. body.errors: { index | item, field?, message }[]            (index 0-based, item 1-based)
 *   2. body.items:  { index, errors | messages: string[] }[]        (index 0-based)
 *   3. message strings (string or string[], also split on "; "):
 *        "items.2.workCompleted: …" / "items[2].workCompleted …"    → index 2 (0-based)
 *        "Item 3: …" / "Item #3 - …"                                → index 2 (1-based in text)
 *      The field is the explicit path segment when present, otherwise the first known field name
 *      (camelCase key or its label) mentioned in the text; "blocker or nextAction" maps to both.
 *      Unrecognized strings go to `top`.
 */
const FIELD_ALIASES: [RegExp, ItemField][] = [
  [/\btask\s*title\b|\btasktitle\b/i, "taskTitle"],
  [/\bwork\s*completed\b|\bworkcompleted\b/i, "workCompleted"],
  [/\bpending\s*work\b|\bpendingwork\b/i, "pendingWork"],
  [/\bnext\s*action\b|\bnextaction\b/i, "nextAction"],
  [/\bblocker\b/i, "blocker"],
  [/\bevidence(\s*url)?\b|\bevidenceurl\b/i, "evidenceUrl"],
  [/\bminutes(\s*spent)?\b|\bminutesspent\b/i, "minutesSpent"],
  [/\bproject\s*name\b|\bprojectname\b/i, "projectName"],
  [/\bresult\b/i, "result"],
];

function fieldsIn(text: string): ItemField[] {
  const found: ItemField[] = [];
  for (const [re, f] of FIELD_ALIASES) if (re.test(text)) found.push(f);
  // "blocker or nextAction" → both; otherwise only the first mention.
  if (found.includes("blocker") && found.includes("nextAction")) return ["blocker", "nextAction"];
  return found.slice(0, 1);
}

function asField(raw: string | undefined | null): ItemField | null {
  if (!raw) return null;
  const k = raw.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (k === "minutes") return "minutesSpent";
  return (ITEM_FIELDS as readonly string[]).find((f) => f.toLowerCase() === k) as ItemField | undefined ?? null;
}

/** Replace camelCase field keys in a server message with human labels. */
export function prettifyMessage(msg: string): string {
  let out = msg;
  for (const f of ITEM_FIELDS) out = out.replace(new RegExp(`\\b${f}\\b`, "g"), FIELD_LABELS[f]);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function placeMessage(e: ReportErrors, index: number, explicitField: ItemField | null, text: string) {
  const msg = prettifyMessage(text.trim() || "Invalid value");
  const fields = explicitField ? [explicitField] : fieldsIn(text);
  if (fields.length === 0) add(e, index, "_item", msg);
  else for (const f of fields) add(e, index, f, msg);
}

const PATH_RE = /^\s*items?\s*(?:\.|\[)\s*(\d+)\s*\]?\s*(?:\.\s*([A-Za-z]+))?\s*[:\-–—]?\s*(.*)$/i;
const ITEM_N_RE = /^\s*item\s*#?\s*(\d+)\s*(?:[:\-–—]|\))\s*(.*)$/i;

export function parseReportApiError(err: unknown, itemCount: number): ReportErrors {
  const e = emptyErrors();
  if (!(err instanceof ApiError)) {
    e.top.push(err instanceof Error ? err.message : "Could not submit the report.");
    return e;
  }
  const body = (err.body ?? {}) as unknown as Record<string, unknown>;
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < Math.max(itemCount, 1);

  if (Array.isArray(body.errors)) {
    for (const raw of body.errors) {
      if (typeof raw === "string") {
        placeString(e, raw, inRange);
        continue;
      }
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const idx = typeof o.index === "number" ? o.index : typeof o.item === "number" ? o.item - 1 : NaN;
      const text = String(o.message ?? o.error ?? "Invalid value");
      if (inRange(idx)) placeMessage(e, idx, asField(typeof o.field === "string" ? o.field : null), text);
      else e.top.push(prettifyMessage(text));
    }
  }
  if (Array.isArray(body.items)) {
    for (const raw of body.items) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const idx = typeof o.index === "number" ? o.index : NaN;
      const msgs = Array.isArray(o.errors) ? o.errors : Array.isArray(o.messages) ? o.messages : [];
      for (const m of msgs) {
        const text = typeof m === "string" ? m : String((m as { message?: unknown })?.message ?? "");
        if (!text) continue;
        if (inRange(idx)) placeMessage(e, idx, null, text);
        else e.top.push(prettifyMessage(text));
      }
    }
  }
  if (errorCount(e) === 0) {
    const m = body.message ?? err.message;
    const list = Array.isArray(m) ? m : typeof m === "string" ? m.split(/;\s+(?=item|items)/i) : [];
    for (const s of list) if (typeof s === "string" && s.trim()) placeString(e, s, inRange);
  }
  if (errorCount(e) === 0) e.top.push(err.message || "The report could not be submitted.");
  return e;
}

function placeString(e: ReportErrors, s: string, inRange: (i: number) => boolean) {
  let m = PATH_RE.exec(s);
  if (m) {
    const idx = Number(m[1]);
    if (inRange(idx)) {
      placeMessage(e, idx, asField(m[2]), m[3] || s);
      return;
    }
  }
  m = ITEM_N_RE.exec(s);
  if (m) {
    const idx = Number(m[1]) - 1;
    if (inRange(idx)) {
      placeMessage(e, idx, null, m[2] || s);
      return;
    }
  }
  e.top.push(prettifyMessage(s.trim()));
}
