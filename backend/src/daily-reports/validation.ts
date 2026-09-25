import type { TaskStatus } from '@prisma/client';

/** Item as submitted by the employee (docs/WORKFORCE.md "Daily work reports"). */
export interface DailyReportItemInput {
  taskId?: string | null;
  projectName?: string | null;
  taskTitle: string;
  workCompleted: string;
  result: string;
  pendingWork?: string | null;
  blocker?: string | null;
  nextAction?: string | null;
  evidenceUrl?: string | null;
  minutesSpent?: number | null;
}

export const MIN_WORK_COMPLETED_CHARS = 15;

/** Generic filler that says nothing about the work actually done. */
const GENERIC_PHRASES = [
  'working on', 'worked on', 'work on', 'same as yesterday', 'as usual', 'as discussed', 'in progress', 'follow up', 'followed up',
  'looked into', 'look into', 'checked', 'check', 'will do', 'to do', 'n/a', 'na', 'nil', 'none', 'nothing', 'etc',
];
const GENERIC_WORDS = new Set([
  'work', 'worked', 'working', 'works', 'done', 'did', 'doing', 'do', 'misc', 'miscellaneous', 'various', 'stuff', 'things', 'thing',
  'task', 'tasks', 'general', 'some', 'many', 'all', 'the', 'a', 'an', 'and', 'or', 'on', 'in', 'of', 'to', 'for', 'with', 'it', 'its',
  'my', 'our', 'was', 'were', 'is', 'are', 'be', 'been', 'continued', 'continue', 'continuing', 'ongoing', 'update', 'updates',
  'updated', 'meeting', 'meetings', 'call', 'calls', 'daily', 'regular', 'routine', 'usual', 'progress', 'completed', 'complete',
  'finished', 'finish', 'today', 'yesterday', 'same', 'other', 'others', 'stuffs', 'job', 'jobs', 'activity', 'activities', 'also',
  'more', 'lot', 'lots', 'etc', 'misc.', 'na', 'ok', 'okay', 'fine', 'good', 'as', 'per', 'at', 'from', 'by', 'this', 'that',
]);

/**
 * True when the text is only generic words ("working on tasks", "done", "misc stuff"):
 * fewer than two meaningful words (>= 3 letters, not generic) remain after removing filler.
 */
export function isVague(text: string | null | undefined): boolean {
  let t = (text ?? '').toLowerCase().trim();
  if (!t) return true;
  for (const p of GENERIC_PHRASES) t = t.split(p).join(' ');
  const words = t
    .replace(/[^\p{L}\p{N}#\-_/.]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-_/]+|[.\-_/]+$/g, ''))
    .filter(Boolean);
  const meaningful = new Set(words.filter((w) => !GENERIC_WORDS.has(w) && (w.length >= 3 || /\d/.test(w))));
  return meaningful.size < 2;
}

export interface ValidationContext {
  /** Status of linked tasks by id (items without a linked task are treated as not DONE only if they reference one). */
  taskStatus: Record<string, TaskStatus | undefined>;
}

/**
 * Submit-time validation. Returns per-item messages (empty = valid):
 *  - at least one item
 *  - taskTitle, workCompleted (>= 15 chars, not only generic words) and result are required
 *  - blocker or nextAction required when the linked task is not DONE
 */
export function validateReportForSubmit(items: DailyReportItemInput[], ctx: ValidationContext): string[] {
  const errors: string[] = [];
  if (!items || !items.length) return ['Add at least one work item before submitting'];
  items.forEach((it, i) => {
    const n = `Item ${i + 1}`;
    if (!it.taskTitle?.trim()) errors.push(`${n}: taskTitle is required`);
    const wc = it.workCompleted?.trim() ?? '';
    if (!wc) errors.push(`${n}: workCompleted is required`);
    else if (wc.length < MIN_WORK_COMPLETED_CHARS) errors.push(`${n}: workCompleted must be at least ${MIN_WORK_COMPLETED_CHARS} characters`);
    else if (isVague(wc)) errors.push(`${n}: workCompleted is too vague — describe the concrete work done (e.g. "Fixed pagination bug in devices API, added tests")`);
    if (!it.result?.trim()) errors.push(`${n}: result is required`);
    if (it.taskId) {
      const status = ctx.taskStatus[it.taskId];
      if (status !== 'DONE' && !it.blocker?.trim() && !it.nextAction?.trim()) {
        errors.push(`${n}: blocker or nextAction is required because the linked task is not DONE`);
      }
    }
  });
  return errors;
}
