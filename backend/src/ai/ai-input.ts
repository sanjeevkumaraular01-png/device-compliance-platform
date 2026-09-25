/**
 * Builds the per-employee JSON sent to Claude (docs/WORKFORCE.md "Input").
 * Whitelist-only: first name, job title, department, schedule, metrics, hour buckets,
 * top 15 apps/domains, tasks, the submitted report, open alerts and a 14-day baseline.
 * Never includes screenshots, window titles or email addresses.
 */

export interface EmployeeInputSource {
  user: { displayName: string; email?: string | null; jobTitle: string | null; department: { name: string } | null };
  date: string;
  policy: { timezone: string; workDays: number[]; workStart: string; workEnd: string; minDailyMinutes: number };
  session: {
    status: string;
    location: string;
    clockInAt: Date | string | null;
    clockOutAt: Date | string | null;
    activeSec: number;
    idleSec: number;
    meetingSec: number;
    productiveSec: number;
    neutralSec: number;
    unproductiveSec: number;
    focusSec: number;
    breakSec: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeMinutes: number;
    missingMinutes: number;
  } | null;
  hours: { hour: string; activeSec: number; idleSec: number; productiveSec: number; unproductiveSec: number; topApp: string | null }[];
  apps: { label: string; kind: string; category: string; seconds: number; windowTitle?: string | null; domain?: string | null; app?: string | null }[];
  tasks: {
    title: string;
    projectName: string | null;
    status: string;
    trackedMinutesToday: number;
    trackedMinutesTotal: number;
    estimatedMinutes: number | null;
    dueDate: Date | string | null;
    delayCount: number;
  }[];
  report: {
    status: string;
    summary: string | null;
    items: {
      taskTitle: string;
      projectName: string | null;
      workCompleted: string;
      result: string;
      pendingWork: string | null;
      blocker: string | null;
      nextAction: string | null;
      minutesSpent: number | null;
    }[];
  } | null;
  alerts: { ruleKey: string | null; severity: string; title: string }[];
  baseline: { days: number; medianActivePercent: number | null; medianProductivePercent: number | null; avgWorkedMinutes: number | null; tasksCompleted: number };
  /** Never forwarded — present only so callers can pass rich rows safely. */
  screenshots?: unknown;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const min = (sec: number) => Math.round(sec / 60);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const iso = (d: Date | string | null) => (d == null ? null : typeof d === 'string' ? d : d.toISOString());

/** Remove email addresses from free text (report text may contain them). */
export function redact(text: string | null | undefined, max = 2000): string | null {
  if (text == null) return null;
  return text.replace(EMAIL_RE, '[email]').substring(0, max);
}

export function firstName(displayName: string): string {
  return (displayName.trim().split(/\s+/)[0] || 'Employee').replace(EMAIL_RE, 'Employee');
}

export function buildEmployeeInput(src: EmployeeInputSource) {
  const s = src.session;
  const working = s ? s.activeSec + s.meetingSec : 0;
  return {
    employee: { firstName: firstName(src.user.displayName), jobTitle: src.user.jobTitle ?? null, department: src.user.department?.name ?? null },
    date: src.date,
    schedule: {
      timezone: src.policy.timezone,
      workDays: src.policy.workDays,
      workStart: src.policy.workStart,
      workEnd: src.policy.workEnd,
      minDailyMinutes: src.policy.minDailyMinutes,
    },
    day: s
      ? {
          attendanceStatus: s.status,
          location: s.location,
          clockInAt: iso(s.clockInAt),
          clockOutAt: iso(s.clockOutAt),
          workedMinutes: min(working),
          activeMinutes: min(s.activeSec),
          meetingMinutes: min(s.meetingSec),
          idleMinutes: min(s.idleSec),
          breakMinutes: min(s.breakSec),
          focusMinutes: min(s.focusSec),
          productiveMinutes: min(s.productiveSec),
          neutralMinutes: min(s.neutralSec),
          unproductiveMinutes: min(s.unproductiveSec),
          activePercent: pct(working, working + s.idleSec),
          productivePercent: pct(s.productiveSec, working),
          lateMinutes: s.lateMinutes,
          earlyLeaveMinutes: s.earlyLeaveMinutes,
          overtimeMinutes: s.overtimeMinutes,
          missingMinutes: s.missingMinutes,
        }
      : 'no activity recorded',
    hourly: src.hours
      .filter((h) => h.activeSec + h.idleSec > 0)
      .map((h) => ({ hour: h.hour.substring(11, 16), activeMin: min(h.activeSec), idleMin: min(h.idleSec), productiveMin: min(h.productiveSec), unproductiveMin: min(h.unproductiveSec), topApp: h.topApp })),
    topApps: [...src.apps]
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 15)
      .map((a) => ({ name: a.label, kind: a.kind, category: a.category, minutes: min(a.seconds) })),
    tasks: src.tasks.slice(0, 30).map((t) => ({
      title: redact(t.title, 300),
      project: t.projectName,
      status: t.status,
      trackedMinutesToday: t.trackedMinutesToday,
      trackedMinutesTotal: t.trackedMinutesTotal,
      estimatedMinutes: t.estimatedMinutes,
      dueDate: iso(t.dueDate)?.substring(0, 10) ?? null,
      dueDateDelays: t.delayCount,
    })),
    submittedReport: src.report
      ? {
          status: src.report.status,
          summary: redact(src.report.summary),
          items: src.report.items.slice(0, 30).map((i) => ({
            task: redact(i.taskTitle, 300),
            project: i.projectName,
            workCompleted: redact(i.workCompleted),
            result: redact(i.result),
            pendingWork: redact(i.pendingWork),
            blocker: redact(i.blocker),
            nextAction: redact(i.nextAction),
            minutesSpent: i.minutesSpent,
          })),
        }
      : 'not submitted',
    openAlerts: src.alerts.slice(0, 20).map((a) => ({ rule: a.ruleKey, severity: a.severity })),
    baseline14d: src.baseline,
  };
}

export interface ManagementInputSource {
  date: string;
  scope: string;
  metrics: { employees: number; present: number; absent: number; late: number; onLeave: number; avgProductivePercent: number; avgActivePercent: number; totalOvertimeHours: number; reportsSubmitted: number; reportsMissing: number };
  employees: { name: string; jobTitle: string | null; workedMinutes: number; productivePercent: number; insight: Record<string, unknown> | null }[];
}

export function buildManagementInput(src: ManagementInputSource) {
  return {
    date: src.date,
    team: src.scope,
    metrics: src.metrics,
    employees: src.employees.slice(0, 200).map((e) => ({
      name: e.name,
      jobTitle: e.jobTitle,
      workedMinutes: e.workedMinutes,
      productivePercent: e.productivePercent,
      insight: e.insight
        ? {
            summary: redact(String(e.insight.summary ?? '')),
            workload: e.insight.workload,
            workloadReason: redact(String(e.insight.workloadReason ?? '')),
            blockers: e.insight.blockers,
            reportConsistency: (e.insight.reportConsistency as { status?: string } | undefined)?.status ?? null,
            riskFlags: e.insight.riskFlags,
            managerNote: redact(String(e.insight.managerNote ?? '')),
          }
        : 'no insight',
    })),
  };
}
