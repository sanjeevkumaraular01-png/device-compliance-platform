import { Injectable } from '@nestjs/common';
import { Prisma, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/types';
import { WorkforcePoliciesService } from './policies.service';
import { WorkforceLiveService } from './live.service';
import { assertDepartmentInScope, workforceUserWhere } from './workforce-scope';
import { pct } from './core/metrics';
import { datesBetween, dayRange, dbDate, fromDbDate } from './core/time';
import { AnalyticsAppsQueryDto, AnalyticsQueryDto } from './workforce.dto';

interface Acc {
  key: string;
  label: string;
  active: number;
  idle: number;
  meeting: number;
  productive: number;
  focus: number;
  overtimeMin: number;
  tracked: number;
  userIds: Set<string>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class WorkforceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: WorkforcePoliciesService,
    private readonly live: WorkforceLiveService,
  ) {}

  private async scope(user: AuthUser, q: { departmentId?: string; userId?: string }) {
    assertDepartmentInScope(user, q.departmentId);
    const and: Prisma.UserWhereInput[] = [workforceUserWhere(user)];
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.userId) and.push({ id: q.userId });
    return this.prisma.user.findMany({
      where: { AND: and },
      select: { id: true, displayName: true, departmentId: true, department: { select: { id: true, name: true } } },
    });
  }

  private async range(q: { from?: string; to?: string }) {
    const today = await this.policies.orgToday();
    return WorkforceLiveService.range(q.from, q.to, today, 7);
  }

  async analytics(user: AuthUser, q: AnalyticsQueryDto) {
    const { from, to } = await this.range(q);
    const users = await this.scope(user, q);
    const ids = users.map((u) => u.id);
    const byId = new Map(users.map((u) => [u.id, u]));
    const tz = await this.policies.orgTimezone();
    const start = dayRange(from, tz).start;
    const end = dayRange(to, tz).end;
    const sessions = ids.length
      ? await this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: { gte: dbDate(from), lte: dbDate(to) } } })
      : [];

    // Tasks relevant to the range: due or completed within it.
    const taskWhere: Prisma.WorkTaskWhereInput = {
      assigneeId: { in: ids },
      ...(q.projectId ? { projectId: q.projectId } : {}),
      OR: [{ dueDate: { gte: start, lt: end } }, { completedAt: { gte: start, lt: end } }],
    };
    const tasks = ids.length
      ? await this.prisma.workTask.findMany({
          where: taskWhere,
          select: { id: true, title: true, status: true, assigneeId: true, projectId: true, completedAt: true, dueDate: true, project: { select: { name: true } } },
        })
      : [];
    const completedIn = (t: (typeof tasks)[number]) => t.status === 'DONE' && !!t.completedAt && t.completedAt >= start && t.completedAt < end;

    let rows: AnalyticsRow[] = [];
    if (q.groupBy === 'employee' || q.groupBy === 'department' || q.groupBy === 'day') {
      const acc = new Map<string, Acc>();
      const keyOf = (s: WorkSession): [string, string] => {
        const u = byId.get(s.userId)!;
        if (q.groupBy === 'employee') return [u.id, u.displayName];
        if (q.groupBy === 'department') return [u.departmentId ?? 'none', u.department?.name ?? 'No department'];
        const d = fromDbDate(s.date);
        return [d, d];
      };
      for (const s of sessions) {
        const [k, label] = keyOf(s);
        const a = acc.get(k) ?? newAcc(k, label);
        add(a, s);
        acc.set(k, a);
      }
      if (q.groupBy === 'day') for (const d of datesBetween(from, to)) if (!acc.has(d)) acc.set(d, newAcc(d, d));
      rows = [...acc.values()].map((a) => {
        const relevant = tasks.filter((t) => {
          if (q.groupBy === 'employee') return t.assigneeId === a.key;
          if (q.groupBy === 'department') return (byId.get(t.assigneeId!)?.departmentId ?? 'none') === a.key;
          const d = t.completedAt && completedIn(t) ? t.completedAt : t.dueDate;
          return !!d && d >= dayRange(a.key, tz).start && d < dayRange(a.key, tz).end;
        });
        return finishRow(a, relevant.filter(completedIn).length, relevant.length);
      });
      rows.sort((x, y) => (q.groupBy === 'day' ? x.key.localeCompare(y.key) : x.label.localeCompare(y.label)));
    } else {
      // project / task: tracked time from time entries, activity mix from segments tagged with the task
      const entries = ids.length
        ? await this.prisma.timeEntry.findMany({
            where: { userId: { in: ids }, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }], ...(q.projectId ? { task: { projectId: q.projectId } } : {}) },
            include: { task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } } },
          })
        : [];
      const segs = ids.length
        ? await this.prisma.$queryRaw<{ task_id: string; active: bigint; idle: bigint; productive: bigint; meeting: bigint }[]>`
            SELECT task_id,
              SUM(CASE WHEN active AND (app_label IS NULL OR app_label NOT LIKE 'Meeting:%') THEN duration_sec ELSE 0 END)::bigint AS active,
              SUM(CASE WHEN NOT active AND (app_label IS NULL OR app_label NOT LIKE 'Meeting:%') THEN duration_sec ELSE 0 END)::bigint AS idle,
              SUM(CASE WHEN (active OR app_label LIKE 'Meeting:%') AND category = 'PRODUCTIVE' THEN duration_sec ELSE 0 END)::bigint AS productive,
              SUM(CASE WHEN app_label LIKE 'Meeting:%' THEN duration_sec ELSE 0 END)::bigint AS meeting
            FROM activity_segments
            WHERE user_id = ANY(${ids}::uuid[]) AND task_id IS NOT NULL AND started_at >= ${start} AND started_at < ${end}
            GROUP BY task_id`
        : [];
      const segByTask = new Map(segs.map((s) => [s.task_id, s]));
      const acc = new Map<string, Acc & { trackedSec: number }>();
      const now = Date.now();
      for (const e of entries) {
        const k = q.groupBy === 'project' ? (e.task.projectId ?? 'none') : e.task.id;
        const label = q.groupBy === 'project' ? (e.task.project?.name ?? 'No project') : e.task.title;
        const a = acc.get(k) ?? { ...newAcc(k, label), trackedSec: 0 };
        const s = Math.max(e.startedAt.getTime(), start.getTime());
        const en = Math.min((e.endedAt?.getTime() ?? now), end.getTime());
        a.trackedSec += Math.max(0, (en - s) / 1000);
        a.userIds.add(e.userId);
        acc.set(k, a);
      }
      const taskIdsByKey = new Map<string, Set<string>>();
      for (const e of entries) {
        const k = q.groupBy === 'project' ? (e.task.projectId ?? 'none') : e.task.id;
        taskIdsByKey.set(k, (taskIdsByKey.get(k) ?? new Set()).add(e.task.id));
      }
      for (const t of tasks) {
        const k = q.groupBy === 'project' ? (t.projectId ?? 'none') : t.id;
        if (!acc.has(k)) acc.set(k, { ...newAcc(k, q.groupBy === 'project' ? (t.project?.name ?? 'No project') : t.title), trackedSec: 0 });
      }
      rows = [...acc.values()].map((a) => {
        for (const tid of taskIdsByKey.get(a.key) ?? []) {
          const s = segByTask.get(tid);
          if (!s) continue;
          a.active += Number(s.active);
          a.idle += Number(s.idle);
          a.productive += Number(s.productive);
          a.meeting += Number(s.meeting);
        }
        const relevant = tasks.filter((t) => (q.groupBy === 'project' ? (t.projectId ?? 'none') === a.key : t.id === a.key));
        const row = finishRow(a, relevant.filter(completedIn).length, relevant.length);
        return { ...row, activeHours: r1(Math.max(a.trackedSec, a.active + a.meeting) / 3600) };
      });
      rows.sort((x, y) => y.activeHours - x.activeHours);
    }

    // trend per day across the whole scope
    const trendAcc = new Map<string, Acc>();
    for (const d of datesBetween(from, to)) trendAcc.set(d, newAcc(d, d));
    for (const s of sessions) {
      const a = trendAcc.get(fromDbDate(s.date));
      if (a) add(a, s);
    }
    const trend = [...trendAcc.values()].map((a) => {
      const w = a.active + a.meeting;
      return { date: a.key, activePercent: pct(w, w + a.idle), productivePercent: pct(a.productive, w), idlePercent: pct(a.idle, w + a.idle) };
    });
    return { from, to, groupBy: q.groupBy, rows, trend };
  }

  async apps(user: AuthUser, q: AnalyticsAppsQueryDto) {
    const { from, to } = await this.range(q);
    const users = await this.scope(user, q);
    const tz = await this.policies.orgTimezone();
    const unscoped = !q.departmentId && !q.userId && user.permissions.includes('workforce:read') && user.roleKey !== 'DEPARTMENT_MANAGER';
    return this.live.appUsage({
      userIds: unscoped ? null : users.map((u) => u.id),
      start: dayRange(from, tz).start,
      end: dayRange(to, tz).end,
      category: q.category,
      limit: 100,
    });
  }
}

export type AnalyticsRow = ReturnType<typeof finishRow>;

function finishRow(a: Acc, completed: number, total: number) {
  const w = a.active + a.meeting;
  return {
    key: a.key,
    label: a.label,
    activePercent: pct(w, w + a.idle),
    idlePercent: pct(a.idle, w + a.idle),
    productivePercent: pct(a.productive, w),
    focusHours: r1(a.focus / 3600),
    meetingHours: r1(a.meeting / 3600),
    activeHours: r1(w / 3600),
    overtimeHours: r1(a.overtimeMin / 60),
    taskCompletionPercent: pct(completed, total),
    tasksCompleted: completed,
    tasksTotal: total,
    employees: a.userIds.size,
  };
}

function newAcc(key: string, label: string): Acc {
  return { key, label, active: 0, idle: 0, meeting: 0, productive: 0, focus: 0, overtimeMin: 0, tracked: 0, userIds: new Set() };
}

function add(a: Acc, s: WorkSession) {
  a.active += s.activeSec;
  a.idle += s.idleSec;
  a.meeting += s.meetingSec;
  a.productive += s.productiveSec;
  a.focus += s.focusSec;
  a.overtimeMin += s.overtimeMinutes;
  a.userIds.add(s.userId);
}
