import type { AlertSeverity, TaskStatus } from '@prisma/client';
import { isoWeekday, addDays, zonedTime } from './time';
import { median, pct } from './metrics';

/**
 * Workforce alert rule evaluators (docs/WORKFORCE.md "Work alerts"). Pure functions:
 * each returns a finding or null; the service raises it with dedupe key
 * `workforce:<ruleKey>:<userId>:<date>`.
 */

export type WorkRuleKey =
  | 'late_login'
  | 'no_activity_after_login'
  | 'excessive_idle'
  | 'unproductive_usage'
  | 'blocked_app_used'
  | 'no_task_selected'
  | 'daily_report_missing'
  | 'excessive_overtime'
  | 'workload_overload'
  | 'deadline_at_risk'
  | 'productivity_drop'
  | 'repeated_task_delay';

export const RULE_SEVERITY: Record<WorkRuleKey, AlertSeverity> = {
  late_login: 'LOW',
  no_task_selected: 'LOW',
  no_activity_after_login: 'MEDIUM',
  excessive_idle: 'MEDIUM',
  unproductive_usage: 'MEDIUM',
  daily_report_missing: 'MEDIUM',
  excessive_overtime: 'MEDIUM',
  productivity_drop: 'MEDIUM',
  repeated_task_delay: 'MEDIUM',
  blocked_app_used: 'HIGH',
  deadline_at_risk: 'HIGH',
  workload_overload: 'HIGH',
};

export interface RuleFinding {
  ruleKey: WorkRuleKey;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

export interface RulePolicy {
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  minDailyMinutes: number;
  alertLateLogin: boolean;
  alertNoActivityMinutes: number;
  alertIdlePercent: number;
  alertOvertimeMinutes: number;
  alertUnproductivePercent: number;
  requireTaskSelection: boolean;
  requireDailyReport: boolean;
  dailyReportDueTime: string;
}

export interface RuleSession {
  activeSec: number;
  idleSec: number;
  meetingSec: number;
  productiveSec: number;
  unproductiveSec: number;
  lateMinutes: number;
  overtimeMinutes: number;
  firstActivityAt: Date | null;
  clockInAt: Date | null;
  status: string;
}

const finding = (ruleKey: WorkRuleKey, title: string, message: string, metadata: Record<string, unknown> = {}): RuleFinding => ({
  ruleKey,
  severity: RULE_SEVERITY[ruleKey],
  title,
  message,
  metadata,
});

const MIN_SAMPLE_SEC = 60 * 60;

export function evalLateLogin(name: string, p: RulePolicy, s: RuleSession | null): RuleFinding | null {
  if (!p.alertLateLogin || !s || s.lateMinutes <= 0 || s.status === 'ON_LEAVE') return null;
  return finding('late_login', `Late login: ${name}`, `${name} started ${s.lateMinutes} min after the scheduled start (${p.workStart} + grace).`, {
    lateMinutes: s.lateMinutes,
  });
}

/** Explicit (web) clock-in with no activity within `alertNoActivityMinutes`. */
export function evalNoActivityAfterLogin(name: string, p: RulePolicy, s: RuleSession | null, explicitClockIn: Date | null, now: Date): RuleFinding | null {
  if (!s || !explicitClockIn || p.alertNoActivityMinutes <= 0) return null;
  const limit = explicitClockIn.getTime() + p.alertNoActivityMinutes * 60_000;
  const first = s.firstActivityAt && s.firstActivityAt >= new Date(explicitClockIn.getTime() - 60_000) ? s.firstActivityAt : null;
  if (now.getTime() < limit) return null;
  if (first && first.getTime() <= limit) return null;
  return finding(
    'no_activity_after_login',
    `No activity after clock-in: ${name}`,
    `${name} clocked in but no computer activity was recorded within ${p.alertNoActivityMinutes} minutes.`,
    { clockInAt: explicitClockIn.toISOString(), firstActivityAt: first?.toISOString() ?? null },
  );
}

export function evalExcessiveIdle(name: string, p: RulePolicy, s: RuleSession | null): RuleFinding | null {
  if (!s) return null;
  const tracked = s.activeSec + s.meetingSec + s.idleSec;
  if (tracked < MIN_SAMPLE_SEC) return null;
  const idlePct = pct(s.idleSec, tracked);
  if (idlePct <= p.alertIdlePercent) return null;
  return finding('excessive_idle', `High idle time: ${name}`, `${name} has been idle ${idlePct}% of tracked time today (threshold ${p.alertIdlePercent}%).`, {
    idlePercent: idlePct,
    idleMinutes: Math.round(s.idleSec / 60),
  });
}

export function evalUnproductiveUsage(name: string, p: RulePolicy, s: RuleSession | null): RuleFinding | null {
  if (!s) return null;
  const working = s.activeSec + s.meetingSec;
  if (working < MIN_SAMPLE_SEC) return null;
  const u = pct(s.unproductiveSec, working);
  if (u <= p.alertUnproductivePercent) return null;
  return finding(
    'unproductive_usage',
    `Unproductive app usage: ${name}`,
    `${u}% of ${name}'s active time today was on apps/sites classified unproductive (threshold ${p.alertUnproductivePercent}%).`,
    { unproductivePercent: u, unproductiveMinutes: Math.round(s.unproductiveSec / 60) },
  );
}

export function evalBlockedApp(name: string, blocked: { label: string; seconds: number }[]): RuleFinding | null {
  const used = blocked.filter((b) => b.seconds > 0);
  if (!used.length) return null;
  const labels = used.map((b) => b.label);
  return finding('blocked_app_used', `Blocked app/site used: ${name}`, `${name} used blocked apps/sites today: ${labels.join(', ')}.`, {
    labels,
    seconds: used.reduce((a, b) => a + b.seconds, 0),
  });
}

export function evalNoTaskSelected(name: string, p: RulePolicy, s: RuleSession | null, online: boolean, hasRunningTimer: boolean): RuleFinding | null {
  if (!p.requireTaskSelection || !s || !online || hasRunningTimer) return null;
  if (s.activeSec + s.meetingSec < 15 * 60) return null;
  return finding('no_task_selected', `No task selected: ${name}`, `${name} is working without a running task timer (task selection is required by policy).`);
}

export function evalExcessiveOvertime(name: string, p: RulePolicy, s: RuleSession | null): RuleFinding | null {
  if (!s || p.alertOvertimeMinutes <= 0 || s.overtimeMinutes < p.alertOvertimeMinutes) return null;
  return finding('excessive_overtime', `Excessive overtime: ${name}`, `${name} has worked ${s.overtimeMinutes} min of overtime today (threshold ${p.alertOvertimeMinutes} min).`, {
    overtimeMinutes: s.overtimeMinutes,
  });
}

export function evalReportMissing(name: string, p: RulePolicy, dateStr: string, hasSession: boolean, submitted: boolean): RuleFinding | null {
  if (!p.requireDailyReport || !hasSession || submitted) return null;
  return finding('daily_report_missing', `Daily report missing: ${name}`, `${name} has not submitted the daily work report for ${dateStr} (due ${p.dailyReportDueTime}).`, {
    date: dateStr,
  });
}

export interface RuleTask {
  id: string;
  title: string;
  status: TaskStatus;
  estimatedMinutes: number | null;
  trackedSec: number;
  dueDate: Date | null;
  delayCount: number;
}

const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];
export const remainingMinutes = (t: RuleTask) => Math.max(0, (t.estimatedMinutes ?? 0) - Math.floor(t.trackedSec / 60));

/** Minutes of scheduled work between `from` and `to` (policy work days/hours). */
export function workMinutesBetween(p: Pick<RulePolicy, 'timezone' | 'workDays' | 'workStart' | 'workEnd'>, from: Date, to: Date, fromDate: string): number {
  if (to <= from) return 0;
  let total = 0;
  for (let i = 0, d = fromDate; i < 60; i++, d = addDays(d, 1)) {
    const dayStart = zonedTime(d, p.workStart, p.timezone);
    if (dayStart >= to) break;
    if (!p.workDays.includes(isoWeekday(d))) continue;
    const dayEnd = zonedTime(d, p.workEnd, p.timezone);
    const s = Math.max(dayStart.getTime(), from.getTime());
    const e = Math.min(dayEnd.getTime(), to.getTime());
    if (e > s) total += (e - s) / 60_000;
  }
  return Math.round(total);
}

/** The next `n` work days starting at `fromDate` (inclusive). */
export function nextWorkDays(p: Pick<RulePolicy, 'workDays'>, fromDate: string, n: number): string[] {
  const out: string[] = [];
  for (let d = fromDate, i = 0; out.length < n && i < 30; d = addDays(d, 1), i++) if (p.workDays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/** Remaining estimates of open tasks due within the next 5 work days (or overdue) > 120% of capacity. */
export function evalWorkloadOverload(name: string, p: RulePolicy, tasks: RuleTask[], todayStr: string): RuleFinding | null {
  const days = nextWorkDays(p, todayStr, 5);
  if (!days.length) return null;
  const horizon = zonedTime(addDays(days[days.length - 1], 1), '00:00', p.timezone);
  const relevant = tasks.filter((t) => OPEN.includes(t.status) && t.dueDate && t.dueDate < horizon);
  const remaining = relevant.reduce((s, t) => s + remainingMinutes(t), 0);
  const capacity = days.length * p.minDailyMinutes;
  if (capacity <= 0 || remaining <= capacity * 1.2) return null;
  return finding(
    'workload_overload',
    `Workload overload: ${name}`,
    `${name} has ${Math.round(remaining / 60)}h of remaining estimated work due within 5 work days vs ${Math.round(capacity / 60)}h capacity (${pct(remaining, capacity)}%).`,
    { remainingMinutes: remaining, capacityMinutes: capacity, taskIds: relevant.map((t) => t.id).slice(0, 50) },
  );
}

/** Task due within 2 days, not done, with remaining estimate > remaining scheduled work minutes. */
export function evalDeadlineAtRisk(name: string, p: RulePolicy, tasks: RuleTask[], now: Date, todayStr: string): RuleFinding | null {
  const limit = now.getTime() + 2 * 86_400_000;
  const risky = tasks.filter((t) => {
    if (!OPEN.includes(t.status) || !t.dueDate || t.dueDate.getTime() > limit) return false;
    const rem = remainingMinutes(t);
    if (rem <= 0) return false;
    return rem > workMinutesBetween(p, now, t.dueDate, todayStr);
  });
  if (!risky.length) return null;
  return finding(
    'deadline_at_risk',
    `Deadline at risk: ${name}`,
    `${risky.length} task(s) of ${name} due within 2 days need more time than remains: ${risky.map((t) => `"${t.title}" (${remainingMinutes(t)} min left)`).slice(0, 5).join(', ')}.`,
    { taskIds: risky.map((t) => t.id) },
  );
}

export function evalRepeatedTaskDelay(name: string, tasks: RuleTask[]): RuleFinding | null {
  const delayed = tasks.filter((t) => OPEN.includes(t.status) && t.delayCount >= 2);
  if (!delayed.length) return null;
  return finding(
    'repeated_task_delay',
    `Repeated task delays: ${name}`,
    `${delayed.length} open task(s) of ${name} had their due date moved 2+ times: ${delayed.map((t) => `"${t.title}" (${t.delayCount}x)`).slice(0, 5).join(', ')}.`,
    { taskIds: delayed.map((t) => t.id) },
  );
}

/** Today's productive % < 60% of the user's 14-day median (needs >= 5 days of history). */
export function evalProductivityDrop(name: string, todayProductivePct: number, history: number[], todayWorkingSec: number): RuleFinding | null {
  if (history.length < 5 || todayWorkingSec < MIN_SAMPLE_SEC) return null;
  const med = median(history.slice(-14));
  if (med === null || med <= 0) return null;
  if (todayProductivePct >= med * 0.6) return null;
  return finding(
    'productivity_drop',
    `Productivity drop: ${name}`,
    `${name}'s productive time was ${todayProductivePct}% today vs a 14-day median of ${Math.round(med * 10) / 10}%.`,
    { todayProductivePercent: todayProductivePct, medianProductivePercent: med, days: history.length },
  );
}

export function dedupeKey(ruleKey: WorkRuleKey, userId: string, dateStr: string): string {
  return `workforce:${ruleKey}:${userId}:${dateStr}`;
}

/** True once the local time in `tz` is at or after `hm` on `dateStr`. */
export function isPastLocalTime(now: Date, dateStr: string, hm: string, tz: string): boolean {
  return now >= zonedTime(dateStr, hm, tz);
}

