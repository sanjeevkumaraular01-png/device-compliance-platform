import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkforcePolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';
import { WorkforcePoliciesService, TrackedUser } from './policies.service';
import { WorkSessionsService } from './sessions.service';
import { WorkforceLiveService } from './live.service';
import {
  dedupeKey,
  evalBlockedApp,
  evalDeadlineAtRisk,
  evalExcessiveIdle,
  evalExcessiveOvertime,
  evalLateLogin,
  evalNoActivityAfterLogin,
  evalNoTaskSelected,
  evalProductivityDrop,
  evalRepeatedTaskDelay,
  evalReportMissing,
  evalUnproductiveUsage,
  evalWorkloadOverload,
  isPastLocalTime,
  RuleFinding,
} from './core/alert-rules';
import { isWorkDay, pct } from './core/metrics';
import { addDays, dayRange, dbDate, localDate } from './core/time';

const STATE_KEY = 'workforce.jobState';
const CLOSE_AFTER = '01:00';

interface JobState {
  closed: Record<string, string>;
  reportMissing: Record<string, string>;
}

type TU = TrackedUser & { policy: WorkforcePolicy };

/** Worker-side workforce jobs: live alert rules, report-missing, nightly close + daily rules. */
@Injectable()
export class WorkforceJobsService {
  private readonly logger = new Logger(WorkforceJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
    private readonly policies: WorkforcePoliciesService,
    private readonly sessions: WorkSessionsService,
    private readonly live: WorkforceLiveService,
  ) {}

  private async state(): Promise<JobState> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: STATE_KEY } });
    const v = (row?.value ?? {}) as Partial<JobState>;
    return { closed: v.closed ?? {}, reportMissing: v.reportMissing ?? {} };
  }

  private async saveState(s: JobState) {
    await this.prisma.systemSetting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value: s as unknown as Prisma.InputJsonValue },
      update: { value: s as unknown as Prisma.InputJsonValue },
    });
  }

  private async raise(u: TU, dateStr: string, f: RuleFinding | null): Promise<boolean> {
    if (!f) return false;
    const r = await this.alerts.raise({
      subjectUserId: u.id,
      category: 'WORKFORCE',
      severity: f.severity,
      ruleKey: f.ruleKey,
      title: f.title,
      message: f.message,
      dedupeKey: dedupeKey(f.ruleKey, u.id, dateStr),
      metadata: { ...f.metadata, date: dateStr, userId: u.id },
    });
    return r.created;
  }


  /** Every 10 minutes: live rules for today's sessions. */
  async runLiveRules(now = new Date()): Promise<{ users: number; raised: number }> {
    const users = await this.policies.trackedUsers();
    const rows = await this.live.buildLive(users, now);
    let raised = 0;
    for (const r of rows) {
      const u = users.find((x) => x.id === r.userId)!;
      const p = r._policy;
      const today = r._today;
      if (!isWorkDay(p, today) && !r._session) continue;
      const s = r._session;
      if (!s || s.status === 'ON_LEAVE' || s.status === 'HOLIDAY') continue;
      const { start, end } = dayRange(today, p.timezone);
      const [explicitIn, blocked] = await Promise.all([
        this.prisma.clockEvent.findFirst({ where: { userId: u.id, type: 'CLOCK_IN', source: 'WEB', occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: 'asc' } }),
        this.prisma.activitySegment.groupBy({
          by: ['appLabel'],
          where: { userId: u.id, category: 'BLOCKED', startedAt: { gte: start, lt: end } },
          _sum: { durationSec: true },
        }),
      ]);
      const name = u.displayName;
      const online = r.status === 'ONLINE_ACTIVE' || r.status === 'ONLINE_IDLE';
      const findings = [
        evalLateLogin(name, p, s),
        evalNoActivityAfterLogin(name, p, s, explicitIn?.occurredAt ?? null, now),
        evalExcessiveIdle(name, p, s),
        evalUnproductiveUsage(name, p, s),
        evalBlockedApp(name, blocked.map((b) => ({ label: b.appLabel ?? 'unknown', seconds: b._sum.durationSec ?? 0 }))),
        evalNoTaskSelected(name, p, s, online, !!r.currentTask),
        evalExcessiveOvertime(name, p, s),
      ];
      for (const f of findings) if (await this.raise(u, today, f)) raised++;
    }
    return { users: rows.length, raised };
  }

  /**
   * Every 10 minutes: per policy time zone
   *  - at `dailyReportDueTime`: daily_report_missing for today's workers without a submitted report
   *  - after local 01:00: close yesterday (freeze sessions, ABSENT/WEEKEND rows) + daily rules
   */
  async runDaily(now = new Date()): Promise<{ closed: string[]; reportChecks: string[]; raised: number }> {
    const state = await this.state();
    const users = await this.policies.trackedUsers();
    const policies = new Map<string, WorkforcePolicy>();
    for (const u of users) policies.set(u.policy.id, u.policy);
    const closed: string[] = [];
    const reportChecks: string[] = [];
    let raised = 0;

    for (const p of policies.values()) {
      const pUsers = users.filter((u) => u.policy.id === p.id);
      const today = localDate(now, p.timezone);
      // report missing (today, after due time)
      if (p.requireDailyReport && state.reportMissing[p.id] !== today && isWorkDay(p, today) && isPastLocalTime(now, today, p.dailyReportDueTime, p.timezone)) {
        raised += await this.reportMissing(pUsers, p, today);
        state.reportMissing[p.id] = today;
        reportChecks.push(`${p.name}:${today}`);
      }
      // nightly close (yesterday, after 01:00 local)
      const yesterday = addDays(today, -1);
      if ((state.closed[p.id] ?? '') < yesterday && isPastLocalTime(now, today, CLOSE_AFTER, p.timezone)) {
        raised += await this.closeDay(pUsers, p, yesterday, now);
        state.closed[p.id] = yesterday;
        closed.push(`${p.name}:${yesterday}`);
      }
    }
    await this.saveState(state);
    return { closed, reportChecks, raised };
  }

  private async reportMissing(users: TU[], p: WorkforcePolicy, date: string): Promise<number> {
    if (!users.length) return 0;
    const ids = users.map((u) => u.id);
    const [sessions, reports] = await Promise.all([
      this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: dbDate(date) }, select: { userId: true, status: true } }),
      this.prisma.dailyWorkReport.findMany({ where: { userId: { in: ids }, date: dbDate(date), status: { not: 'DRAFT' } }, select: { userId: true } }),
    ]);
    const worked = new Set(sessions.filter((s) => !['ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND'].includes(s.status)).map((s) => s.userId));
    const submitted = new Set(reports.map((r) => r.userId));
    let raised = 0;
    for (const u of users) {
      if (await this.raise(u, date, evalReportMissing(u.displayName, p, date, worked.has(u.id), submitted.has(u.id)))) raised++;
    }
    return raised;
  }

  /** Freeze sessions of `date`, add ABSENT/WEEKEND rows, run daily rules. */
  async closeDay(users: TU[], p: WorkforcePolicy, date: string, now = new Date()): Promise<number> {
    let raised = 0;
    let closedCount = 0;
    for (const u of users) {
      try {
        const s = await this.sessions.recompute(u.id, date, { policy: p, final: true, now, createIfMissing: true });
        if (s) closedCount++;
        raised += await this.dailyRules(u, p, date, now, s ? { productivePercent: pct(s.productiveSec, s.activeSec + s.meetingSec), working: s.activeSec + s.meetingSec, status: s.status } : null);
      } catch (e) {
        this.logger.warn(`close ${date} failed for user ${u.id}: ${(e as Error).message}`);
      }
    }
    await this.audit.log({
      category: 'SYSTEM',
      action: 'workforce.day.close',
      actorType: 'SYSTEM',
      actorId: null,
      actorName: 'scheduler',
      resourceType: 'WorkforcePolicy',
      resourceId: p.id,
      after: { date, sessions: closedCount, alertsRaised: raised },
    });
    return raised;
  }

  private async dailyRules(u: TU, p: WorkforcePolicy, date: string, now: Date, day: { productivePercent: number; working: number; status: string } | null) {
    let raised = 0;
    const name = u.displayName;
    const tasks = await this.prisma.workTask.findMany({
      where: { assigneeId: u.id, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] } },
      select: { id: true, title: true, status: true, estimatedMinutes: true, trackedSec: true, dueDate: true, delayCount: true },
    });
    const today = localDate(now, p.timezone);
    const findings: (RuleFinding | null)[] = [
      evalWorkloadOverload(name, p, tasks, today),
      evalDeadlineAtRisk(name, p, tasks, now, today),
      evalRepeatedTaskDelay(name, tasks),
    ];
    if (day && !['ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND'].includes(day.status)) {
      const hist = await this.prisma.workSession.findMany({
        where: { userId: u.id, date: { gte: dbDate(addDays(date, -14)), lt: dbDate(date) }, status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] } },
        select: { date: true, productiveSec: true, activeSec: true, meetingSec: true },
        orderBy: { date: 'asc' },
      });
      const history = hist.filter((h) => h.activeSec + h.meetingSec >= 3600).map((h) => pct(h.productiveSec, h.activeSec + h.meetingSec));
      findings.push(evalProductivityDrop(name, day.productivePercent, history, day.working));
    }
    for (const f of findings) {
      // productivity_drop belongs to the closed day; task rules to the day they are evaluated on
      const key = f?.ruleKey === 'productivity_drop' ? date : today;
      if (await this.raise(u, key, f)) raised++;
    }
    return raised;
  }

  /** For tests/manual runs: close a specific date for everyone tracked. */
  async closeDate(date: string) {
    const users = await this.policies.trackedUsers();
    const byPolicy = new Map<string, TU[]>();
    for (const u of users) byPolicy.set(u.policy.id, [...(byPolicy.get(u.policy.id) ?? []), u]);
    let raised = 0;
    for (const list of byPolicy.values()) raised += await this.closeDay(list, list[0].policy, date);
    return { date, raised };
  }

}
