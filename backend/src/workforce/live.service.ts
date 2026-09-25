import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityCategory, ClockEvent, Prisma, WorkforcePolicy, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/types';
import { WorkforcePoliciesService, TrackedUser, publicPolicy, trackingNoticeText } from './policies.service';
import { assertCanView, assertDepartmentInScope, workforceUserWhere } from './workforce-scope';
import { clockState, isWorkDay, liveStatus, LiveStatus, pct } from './core/metrics';
import { timelineFromHourly, timelineFromSegments, HourBucket } from './core/timeline';
import { addDays, dayRange, dbDate, localDate, zonedTime } from './core/time';
import { LiveQueryDto, SummaryQueryDto } from './workforce.dto';

export interface AppUsage {
  label: string;
  app: string | null;
  domain: string | null;
  kind: 'APP' | 'WEBSITE';
  category: ActivityCategory;
  seconds: number;
  percent: number;
}

export interface LiveEmployee {
  userId: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  status: LiveStatus;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  productivePercent: number;
  currentApp: string | null;
  currentDomain: string | null;
  currentCategory: ActivityCategory | null;
  currentTask: { id: string; title: string; projectName: string | null } | null;
  location: WorkSession['location'];
  lateMinutes: number;
  deviceName: string | null;
}

type TU = TrackedUser & { policy: WorkforcePolicy };

@Injectable()
export class WorkforceLiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: WorkforcePoliciesService,
  ) {}

  async scopedUsers(user: AuthUser, departmentId?: string, search?: string): Promise<TU[]> {
    assertDepartmentInScope(user, departmentId);
    const and: Prisma.UserWhereInput[] = [workforceUserWhere(user)];
    if (departmentId) and.push({ departmentId });
    if (search) and.push({ OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] });
    return this.policies.trackedUsers({ AND: and });
  }

  // ───────────────────────── Live board ─────────────────────────

  async buildLive(users: TU[], now = new Date()): Promise<(LiveEmployee & { _session: WorkSession | null; _today: string; _policy: WorkforcePolicy })[]> {
    if (!users.length) return [];
    const ids = users.map((u) => u.id);
    const todays = new Map(users.map((u) => [u.id, localDate(now, u.policy.timezone)]));
    const dates = [...new Set(todays.values())].map(dbDate);
    const since = new Date(now.getTime() - 36 * 3_600_000);
    const [sessions, lastSegs, events, timers] = await Promise.all([
      this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: { in: dates } } }),
      this.prisma.$queryRaw<{ user_id: string; ended_at: Date; active: boolean; app: string | null; app_label: string | null; domain: string | null; category: ActivityCategory; device_id: string }[]>`
        SELECT DISTINCT ON (user_id) user_id, ended_at, active, app, app_label, domain, category, device_id
        FROM activity_segments
        WHERE user_id = ANY(${ids}::uuid[]) AND started_at >= ${since}
        ORDER BY user_id, ended_at DESC`,
      this.prisma.clockEvent.findMany({
        where: { userId: { in: ids }, occurredAt: { gte: since }, type: { in: ['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END'] } },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.timeEntry.findMany({
        where: { userId: { in: ids }, endedAt: null },
        include: { task: { select: { id: true, title: true, project: { select: { name: true } } } } },
      }),
    ]);
    const deviceIds = [...new Set([...sessions.map((s) => s.deviceId), ...lastSegs.map((s) => s.device_id)].filter((x): x is string => !!x))];
    const [devices, assigned] = await Promise.all([
      deviceIds.length ? this.prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, deviceName: true } }) : [],
      this.prisma.device.findMany({ where: { assignedUserId: { in: ids }, status: { not: 'RETIRED' } }, select: { assignedUserId: true, deviceName: true } }),
    ]);
    const devName = new Map(devices.map((d) => [d.id, d.deviceName]));
    const sessByUser = new Map(sessions.map((s) => [`${s.userId}:${s.date.toISOString().substring(0, 10)}`, s]));
    const segByUser = new Map(lastSegs.map((s) => [s.user_id, s]));
    const timerByUser = new Map(timers.map((t) => [t.userId, t]));
    const evByUser = new Map<string, ClockEvent[]>();
    for (const e of events) evByUser.set(e.userId, [...(evByUser.get(e.userId) ?? []), e]);

    return users.map((u) => {
      const today = todays.get(u.id)!;
      const { start, end } = dayRange(today, u.policy.timezone);
      const s = sessByUser.get(`${u.id}:${today}`) ?? null;
      const evs = (evByUser.get(u.id) ?? []).filter((e) => e.occurredAt >= start && e.occurredAt < end);
      const cs = clockState(evs);
      const seg = segByUser.get(u.id);
      const lastSeg = seg && seg.ended_at >= start ? { endedAt: seg.ended_at, active: seg.active, appLabel: seg.app_label } : null;
      const status = liveStatus(cs, lastSeg, now);
      const online = status === 'ONLINE_ACTIVE' || status === 'ONLINE_IDLE';
      const t = timerByUser.get(u.id);
      const working = (s?.activeSec ?? 0) + (s?.meetingSec ?? 0);
      return {
        userId: u.id,
        displayName: u.displayName,
        email: u.email,
        jobTitle: u.jobTitle,
        department: u.department,
        status,
        clockInAt: s?.clockInAt ?? cs.firstClockIn,
        clockOutAt: s?.clockOutAt ?? (cs.clockedOut ? cs.lastClockOut : null),
        firstActivityAt: s?.firstActivityAt ?? null,
        lastActivityAt: s?.lastActivityAt ?? null,
        activeSec: working,
        idleSec: s?.idleSec ?? 0,
        productiveSec: s?.productiveSec ?? 0,
        productivePercent: pct(s?.productiveSec ?? 0, working),
        currentApp: online && seg ? (seg.app_label ?? seg.app) : null,
        currentDomain: online && seg ? seg.domain : null,
        currentCategory: online && seg ? seg.category : null,
        currentTask: t ? { id: t.task.id, title: t.task.title, projectName: t.task.project?.name ?? null } : null,
        location: s?.location ?? 'UNKNOWN',
        lateMinutes: s?.lateMinutes ?? 0,
        deviceName: (s?.deviceId && devName.get(s.deviceId)) || (seg && devName.get(seg.device_id)) || assigned.find((d) => d.assignedUserId === u.id)?.deviceName || null,
        _session: s,
        _today: today,
        _policy: u.policy,
      };
    });
  }

  async live(user: AuthUser, q: LiveQueryDto): Promise<LiveEmployee[]> {
    const users = await this.scopedUsers(user, q.departmentId, q.search);
    const rows = await this.buildLive(users);
    return rows.filter((r) => !q.status || r.status === q.status).map(strip);
  }

  // ───────────────────────── Summary ─────────────────────────

  async summary(user: AuthUser, q: SummaryQueryDto) {
    const now = new Date();
    const orgToday = await this.policies.orgToday();
    const date = q.date ?? orgToday;
    const users = await this.scopedUsers(user, q.departmentId);
    const ids = users.map((u) => u.id);
    const isToday = date === orgToday;
    const live = isToday ? await this.buildLive(users, now) : [];
    const liveBy = new Map(live.map((l) => [l.userId, l]));
    const sessions = ids.length ? await this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: dbDate(date) } }) : [];
    const sessBy = new Map(sessions.map((s) => [s.userId, s]));

    const counts = { online: 0, activeNow: 0, idleNow: 0, onBreak: 0, offline: 0, absent: 0, late: 0, onLeave: 0, remote: 0, office: 0 };
    let activePctSum = 0, prodPctSum = 0, withData = 0, activeSec = 0, overtimeMin = 0;
    const perDept = new Map<string, { departmentId: string | null; departmentName: string; employees: number; online: number; prodSum: number; prodN: number; late: number; absent: number }>();
    for (const u of users) {
      const s = sessBy.get(u.id);
      const l = liveBy.get(u.id);
      const dk = u.departmentId ?? 'none';
      const d = perDept.get(dk) ?? { departmentId: u.departmentId, departmentName: u.department?.name ?? 'No department', employees: 0, online: 0, prodSum: 0, prodN: 0, late: 0, absent: 0 };
      d.employees++;
      if (l) {
        if (l.status === 'ONLINE_ACTIVE') counts.activeNow++;
        if (l.status === 'ONLINE_IDLE') counts.idleNow++;
        if (l.status === 'ONLINE_ACTIVE' || l.status === 'ONLINE_IDLE') {
          counts.online++;
          d.online++;
        }
        if (l.status === 'ON_BREAK') counts.onBreak++;
        if (l.status === 'OFFLINE' || l.status === 'CLOCKED_OUT') counts.offline++;
      }
      const workday = isWorkDay(u.policy, date);
      const lateCutoff = new Date(zonedTime(date, u.policy.workStart, u.policy.timezone).getTime() + u.policy.graceMinutes * 60_000);
      const absent = s ? s.status === 'ABSENT' : workday && (date < orgToday || (isToday && now > lateCutoff));
      if (absent) {
        counts.absent++;
        d.absent++;
      }
      if (s) {
        if (s.lateMinutes > 0) {
          counts.late++;
          d.late++;
        }
        if (s.status === 'ON_LEAVE') counts.onLeave++;
        if (s.location === 'REMOTE') counts.remote++;
        if (s.location === 'OFFICE') counts.office++;
        const working = s.activeSec + s.meetingSec;
        const tracked = working + s.idleSec;
        if (tracked > 0) {
          withData++;
          activePctSum += pct(working, tracked);
          prodPctSum += pct(s.productiveSec, working);
          d.prodSum += pct(s.productiveSec, working);
          d.prodN++;
        }
        activeSec += working;
        overtimeMin += s.overtimeMinutes;
      }
      perDept.set(dk, d);
    }

    const reportsSubmitted = ids.length
      ? await this.prisma.dailyWorkReport.count({ where: { userId: { in: ids }, date: dbDate(date), status: { in: ['SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'] } } })
      : 0;
    const submittedIds = new Set(
      ids.length
        ? (await this.prisma.dailyWorkReport.findMany({ where: { userId: { in: ids }, date: dbDate(date), status: { not: 'DRAFT' } }, select: { userId: true } })).map((r) => r.userId)
        : [],
    );
    const reportsMissing = users.filter((u) => {
      const s = sessBy.get(u.id);
      return u.policy.requireDailyReport && isWorkDay(u.policy, date) && s && !['ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND'].includes(s.status) && !submittedIds.has(u.id);
    }).length;
    const openWorkAlerts = ids.length
      ? await this.prisma.alert.count({ where: { category: 'WORKFORCE', status: { in: ['OPEN', 'ACKNOWLEDGED'] }, subjectUserId: { in: ids } } })
      : 0;
    const tzForRange = users[0]?.policy.timezone ?? (await this.policies.orgTimezone());
    const { start, end } = dayRange(date, tzForRange);
    const topApps = (await this.appUsage({ userIds: ids, start, end, limit: 10 })).map((a) => ({ label: a.label, category: a.category, seconds: a.seconds }));

    return {
      date,
      totalEmployees: users.length,
      ...counts,
      avgActivePercent: withData ? Math.round((activePctSum / withData) * 10) / 10 : 0,
      avgProductivePercent: withData ? Math.round((prodPctSum / withData) * 10) / 10 : 0,
      totalActiveHours: Math.round((activeSec / 3600) * 10) / 10,
      totalOvertimeHours: Math.round((overtimeMin / 60) * 10) / 10,
      reportsSubmitted,
      reportsMissing,
      openWorkAlerts,
      byDepartment: [...perDept.values()]
        .map((d) => ({
          departmentId: d.departmentId,
          departmentName: d.departmentName,
          employees: d.employees,
          online: d.online,
          avgProductivePercent: d.prodN ? Math.round((d.prodSum / d.prodN) * 10) / 10 : 0,
          late: d.late,
          absent: d.absent,
        }))
        .sort((a, b) => a.departmentName.localeCompare(b.departmentName)),
      topApps,
    };
  }

  // ───────────────────────── Me ─────────────────────────

  async me(user: AuthUser) {
    const { user: u, policy } = await this.policies.forUser(user.id);
    const [row] = await this.buildLive([{ ...u, policy }]);
    const running = await this.prisma.timeEntry.findFirst({
      where: { userId: user.id, endedAt: null },
      include: { task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } } },
    });
    return {
      policy: publicPolicy(policy),
      today: row._session,
      status: row.status,
      runningTimer: running,
      trackingNotice: policy.trackingEnabled && policy.showTrackingNotice ? trackingNoticeText(policy, await this.policies.companyName()) : null,
    };
  }

  // ───────────────────────── Employee day ─────────────────────────

  async targetFor(user: AuthUser, userId: string, perm: 'workforce:read' = 'workforce:read') {
    const { user: target, policy } = await this.policies.forUser(userId).catch(() => {
      throw new NotFoundException('User not found');
    });
    assertCanView(user, target, perm, { selfAllowed: policy.employeeCanSeeOwnData });
    return { target, policy };
  }

  async timelineFor(userId: string, date: string, tz: string): Promise<HourBucket[]> {
    const { start, end } = dayRange(date, tz);
    const segs = await this.prisma.activitySegment.findMany({
      where: { userId, startedAt: { gte: start, lt: end } },
      select: { startedAt: true, endedAt: true, active: true, category: true, appLabel: true },
    });
    if (segs.length) return timelineFromSegments(segs, date, tz);
    const hourly = await this.prisma.activityHourly.findMany({
      where: { userId, hour: { gte: new Date(start.getTime() - 3_600_000), lt: end } },
    });
    return timelineFromHourly(hourly, date, tz);
  }

  async timeline(user: AuthUser, userId: string, date?: string) {
    const { policy } = await this.targetFor(user, userId);
    return this.timelineFor(userId, date ?? localDate(new Date(), policy.timezone), policy.timezone);
  }

  async apps(user: AuthUser, userId: string, from?: string, to?: string) {
    const { policy } = await this.targetFor(user, userId);
    const today = localDate(new Date(), policy.timezone);
    const t = to ?? from ?? today;
    const f = from ?? t;
    return this.appUsage({ userIds: [userId], start: dayRange(f, policy.timezone).start, end: dayRange(t, policy.timezone).end });
  }

  async day(user: AuthUser, userId: string, date?: string) {
    const { target, policy } = await this.targetFor(user, userId);
    const d = date ?? localDate(new Date(), policy.timezone);
    const { start, end } = dayRange(d, policy.timezone);
    const canAi = userId === user.id || user.permissions.includes('workforce:ai');
    const [u, session, timeline, apps, clockEvents, entries, report, screenshotsCount, aiInsight, alerts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, email: true, jobTitle: true, department: { select: { id: true, name: true } }, role: { select: { key: true, name: true } } },
      }),
      this.prisma.workSession.findUnique({ where: { userId_date: { userId, date: dbDate(d) } } }),
      this.timelineFor(userId, d, policy.timezone),
      this.appUsage({ userIds: [userId], start, end }),
      this.prisma.clockEvent.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: 'asc' } }),
      this.prisma.timeEntry.findMany({
        where: { userId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
        include: { task: { select: { id: true, title: true, status: true, estimatedMinutes: true, project: { select: { name: true } } } } },
      }),
      this.prisma.dailyWorkReport.findUnique({ where: { userId_date: { userId, date: dbDate(d) } }, include: { items: { orderBy: { sortOrder: 'asc' } } } }),
      this.prisma.screenshot.count({ where: { userId, capturedAt: { gte: start, lt: end } } }),
      canAi ? this.prisma.aiInsight.findFirst({ where: { userId, type: 'EMPLOYEE_DAILY', date: dbDate(d), status: 'READY' } }) : null,
      this.prisma.alert.findMany({ where: { subjectUserId: userId, category: 'WORKFORCE', dedupeKey: { endsWith: `:${d}` } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const now = new Date();
    const tasks = new Map<string, { id: string; title: string; projectName: string | null; trackedSecToday: number; estimatedMinutes: number | null; status: string }>();
    for (const e of entries) {
      const s = Math.max(e.startedAt.getTime(), start.getTime());
      const en = Math.min((e.endedAt ?? now).getTime(), end.getTime());
      const cur = tasks.get(e.taskId) ?? {
        id: e.task.id, title: e.task.title, projectName: e.task.project?.name ?? null, trackedSecToday: 0, estimatedMinutes: e.task.estimatedMinutes, status: e.task.status,
      };
      cur.trackedSecToday += Math.max(0, Math.round((en - s) / 1000));
      tasks.set(e.taskId, cur);
    }
    return {
      user: u ? { ...u, departmentId: target.departmentId } : null,
      date: d,
      session,
      timeline,
      apps,
      clockEvents,
      tasks: [...tasks.values()].sort((a, b) => b.trackedSecToday - a.trackedSecToday),
      report,
      screenshotsCount,
      aiInsight,
      alerts,
    };
  }

  // ───────────────────────── App usage ─────────────────────────

  /** App/website usage (active + meeting time) grouped by label + category. `userIds` null = everyone. */
  async appUsage(opts: { userIds: string[] | null; start: Date; end: Date; category?: ActivityCategory; limit?: number }): Promise<AppUsage[]> {
    if (opts.userIds && !opts.userIds.length) return [];
    const userFilter = opts.userIds ? Prisma.sql`AND user_id = ANY(${opts.userIds}::uuid[])` : Prisma.empty;
    const catFilter = opts.category ? Prisma.sql`AND category = ${opts.category}::"ActivityCategory"` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ label: string; app: string | null; domain: string | null; kind: 'APP' | 'WEBSITE'; category: ActivityCategory; seconds: bigint }[]>`
      SELECT COALESCE(app_label, domain, app, 'Unknown') AS label, MIN(app) AS app, MIN(domain) AS domain,
             CASE WHEN bool_or(domain IS NOT NULL) THEN 'WEBSITE' ELSE 'APP' END AS kind,
             category, SUM(duration_sec)::bigint AS seconds
      FROM activity_segments
      WHERE started_at >= ${opts.start} AND started_at < ${opts.end}
        AND (active OR app_label LIKE 'Meeting:%') ${userFilter} ${catFilter}
      GROUP BY 1, category
      ORDER BY seconds DESC
      LIMIT ${opts.limit ?? 50}`;
    const total = rows.reduce((s, r) => s + Number(r.seconds), 0);
    return rows.map((r) => ({ ...r, seconds: Number(r.seconds), percent: pct(Number(r.seconds), total) }));
  }

  /** Local dates helper for callers. */
  static range(from: string | undefined, to: string | undefined, today: string, defaultDays = 7) {
    const t = to ?? today;
    const f = from ?? addDays(t, -(defaultDays - 1));
    return { from: f <= t ? f : t, to: f <= t ? t : f };
  }
}

function strip<T extends { _session: unknown; _today: unknown; _policy: unknown }>(r: T): Omit<T, '_session' | '_today' | '_policy'> {
  const { _session, _today, _policy, ...rest } = r;
  return rest;
}
