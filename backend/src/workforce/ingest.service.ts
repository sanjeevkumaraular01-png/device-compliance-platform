import { Injectable, Logger } from '@nestjs/common';
import { ActivityCategory, ClockEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { MetricsService } from '../metrics/metrics.service';
import type { AgentDevice } from '../common/types';
import { WorkforcePoliciesService, TrackedUser, TRACKED_USER_SELECT, trackingNoticeText } from './policies.service';
import { WorkSessionsService } from './sessions.service';
import { categoryBucket, classify, isMeetingLabel, normalizeDomain, RuleLike } from './core/classifier';
import { resolveLocation } from './core/metrics';
import { dayRange, hmToMinutes, localDate, localParts } from './core/time';
import { dedupeKey } from './core/alert-rules';
import { AgentActivityDto } from './workforce.dto';

const MAX_SEGMENT_SEC = 300;
const MAX_AGE_MS = 14 * 86_400_000;
const USER_CACHE_MS = 5 * 60_000;
const SYSTEM_ACCOUNTS = new Set(['root', 'administrator', 'admin', 'system', 'localsystem', 'guest', 'defaultaccount']);

/** Strip the domain from an OS login: "CORP\\ekta" / "ekta@corp.local" -> "ekta". */
export function osUserLocalPart(osUser: string | null | undefined): string | null {
  if (!osUser) return null;
  const local = osUser.split('\\').pop()!.split('@')[0].trim().toLowerCase();
  if (!local || SYSTEM_ACCOUNTS.has(local) || local.endsWith('$')) return null;
  return local;
}

export interface AgentWorkforcePolicy {
  enabled: boolean;
  idleThresholdSec: number;
  trackApps: boolean;
  trackWebsites: boolean;
  captureWindowTitles: boolean;
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  trackOutsideWorkHours: boolean;
  screenshots: { enabled: boolean; intervalMin: number; blur: boolean };
  showTrackingNotice: boolean;
  noticeText: string;
  currentTask: { id: string; title: string } | null;
  clockedOut: boolean;
}

interface Candidate {
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  active: boolean;
  app: string | null;
  domain: string | null;
  windowTitle: string | null;
  inputEvents: number;
  dateStr: string;
}

/** Agent → server workforce ingestion (`POST /agent/activity`). */
@Injectable()
export class WorkforceIngestService {
  private readonly logger = new Logger(WorkforceIngestService.name);
  private readonly userCache = new Map<string, { at: number; user: TrackedUser | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: WorkforcePoliciesService,
    private readonly sessions: WorkSessionsService,
    private readonly alerts: AlertsService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Resolve the employee behind an agent: the device's assigned user, else the OS login
   * matched to `externalId` (also `DOMAIN\\sAMAccountName`) or the email local-part.
   */
  async resolveUser(device: Pick<AgentDevice, 'id' | 'assignedUserId'>, osUser?: string | null): Promise<TrackedUser | null> {
    if (device.assignedUserId) {
      const u = await this.prisma.user.findFirst({ where: { id: device.assignedUserId, isActive: true }, select: TRACKED_USER_SELECT });
      if (u) return u;
    }
    const local = osUserLocalPart(osUser);
    if (!local) return null;
    const key = `${device.id}:${local}`;
    const hit = this.userCache.get(key);
    if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { externalId: { equals: local, mode: 'insensitive' } },
          { externalId: { endsWith: `\\${local}`, mode: 'insensitive' } },
          { email: { startsWith: `${local}@`, mode: 'insensitive' } },
        ],
      },
      select: TRACKED_USER_SELECT,
      take: 2,
    });
    const user = users.length === 1 ? users[0] : null;
    if (this.userCache.size > 10_000) this.userCache.clear();
    this.userCache.set(key, { at: Date.now(), user });
    return user;
  }

  async ingestActivity(agent: AgentDevice, dto: AgentActivityDto): Promise<{ accepted: number; userId: string | null }> {
    const user = await this.resolveUser(agent, dto.osUser);
    if (!user) {
      this.logger.warn(`Dropping ${dto.segments.length} activity segment(s) from device ${agent.id}: OS user "${dto.osUser}" does not map to a console user`);
      return { accepted: 0, userId: null };
    }
    const policy = await this.policies.forDepartment(user.departmentId);
    const now = new Date();
    await this.prisma.device.update({ where: { id: agent.id }, data: { lastSeenAt: now } }).catch(() => undefined);
    if (!policy.trackingEnabled) return { accepted: 0, userId: user.id };
    const tz = policy.timezone;

    // 1. sanitize + normalize
    const candidates: Candidate[] = [];
    for (const s of dto.segments) {
      const startedAt = new Date(s.startedAt);
      let endedAt = new Date(s.endedAt);
      if (!(endedAt > startedAt)) continue;
      if (startedAt.getTime() > now.getTime() + 5 * 60_000 || now.getTime() - startedAt.getTime() > MAX_AGE_MS) continue;
      if ((endedAt.getTime() - startedAt.getTime()) / 1000 > MAX_SEGMENT_SEC + 10) endedAt = new Date(startedAt.getTime() + MAX_SEGMENT_SEC * 1000);
      candidates.push({
        startedAt,
        endedAt,
        durationSec: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
        active: s.active,
        app: policy.trackApps && s.app ? s.app.trim().substring(0, 255) || null : null,
        domain: policy.trackWebsites ? normalizeDomain(s.domain) : null,
        windowTitle: policy.captureWindowTitles && s.windowTitle ? s.windowTitle.substring(0, 1024) : null,
        inputEvents: Math.max(0, Math.round(s.inputEvents || 0)),
        dateStr: localDate(startedAt, tz),
      });
    }
    candidates.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    // 2. idempotency: drop segments overlapping stored ones for this device (spool resends) or each other
    let fresh: Candidate[] = [];
    if (candidates.length) {
      const minStart = candidates[0].startedAt;
      const maxEnd = new Date(Math.max(...candidates.map((c) => c.endedAt.getTime())));
      const stored = await this.prisma.activitySegment.findMany({
        where: { deviceId: agent.id, startedAt: { lt: maxEnd }, endedAt: { gt: minStart } },
        select: { startedAt: true, endedAt: true },
      });
      let lastEnd = 0;
      for (const c of candidates) {
        const overlapsStored = stored.some((x) => c.startedAt < x.endedAt && c.endedAt > x.startedAt);
        if (overlapsStored || c.startedAt.getTime() < lastEnd) continue;
        fresh.push(c);
        lastEnd = c.endedAt.getTime();
      }
    }

    // 3. tracking window + clock-out: per local day
    const dates = [...new Set(fresh.map((c) => c.dateStr))];
    const eventsByDate = new Map<string, { type: ClockEventType; occurredAt: Date; source: string }[]>();
    for (const d of dates) {
      const { start, end } = dayRange(d, tz);
      eventsByDate.set(
        d,
        await this.prisma.clockEvent.findMany({
          where: { userId: user.id, occurredAt: { gte: start, lt: end }, type: { in: ['CLOCK_IN', 'CLOCK_OUT'] } },
          orderBy: { occurredAt: 'asc' },
          select: { type: true, occurredAt: true, source: true },
        }),
      );
    }
    const startMin = hmToMinutes(policy.workStart);
    const endMin = hmToMinutes(policy.workEnd);
    fresh = fresh.filter((c) => {
      const state = WorkSessionsService.stateAt(eventsByDate.get(c.dateStr) ?? [], c.startedAt);
      if (state === 'OUT') return false; // clocked out: stop collecting until the next clock-in
      if (policy.trackOutsideWorkHours || state === 'IN_MANUAL') return true;
      const p = localParts(c.startedAt, tz);
      const minute = p.hour * 60 + p.minute;
      return policy.workDays.includes(p.weekday) && minute >= startMin && minute < endMin;
    });

    const observedLocation = dto.network ? resolveLocation(dto.network, policy.officeNetworks) : undefined;

    // 4. classify + persist
    let accepted = 0;
    if (fresh.length) {
      const rules = (await this.policies.rules()) as RuleLike[];
      const running = await this.prisma.timeEntry.findFirst({ where: { userId: user.id, endedAt: null }, select: { taskId: true, startedAt: true } });
      const rows: Prisma.ActivitySegmentCreateManyInput[] = fresh.map((c) => {
        const cls = classify({ app: c.app, domain: c.domain }, rules, user.departmentId);
        return {
          userId: user.id,
          deviceId: agent.id,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          durationSec: c.durationSec,
          active: c.active,
          app: c.app,
          appLabel: cls.label,
          domain: c.domain,
          windowTitle: c.windowTitle,
          category: cls.category,
          inputEvents: c.inputEvents,
          taskId: running && running.startedAt <= c.endedAt ? running.taskId : null,
        };
      });
      await this.prisma.activitySegment.createMany({ data: rows });
      accepted = rows.length;
      this.metrics.workforceSegments.inc(accepted);
      await this.updateHourly(user.id, rows);

      // 5. auto clock-in on the first active segment of a local day
      for (const d of dates) {
        const firstActive = rows.find((r) => r.active && localDate(r.startedAt as Date, tz) === d);
        const evs = eventsByDate.get(d) ?? [];
        if (firstActive && !evs.some((e) => e.type === 'CLOCK_IN')) {
          await this.prisma.clockEvent.create({
            data: {
              userId: user.id, deviceId: agent.id, type: 'CLOCK_IN', source: 'AGENT', location: observedLocation ?? 'UNKNOWN',
              ipAddress: dto.network?.ips?.[0] ?? null, note: 'Automatic (first activity of the day)', occurredAt: firstActive.startedAt as Date,
            },
          });
        }
      }

      // 6. blocked apps/sites raise an alert immediately
      const blocked = rows.filter((r) => r.category === 'BLOCKED' && (r.active || isMeetingLabel(r.appLabel ?? null)));
      if (blocked.length) {
        const labels = [...new Set(blocked.map((b) => b.appLabel ?? b.domain ?? b.app ?? 'unknown'))];
        const d = localDate(blocked[0].startedAt as Date, tz);
        await this.alerts.raise({
          subjectUserId: user.id,
          deviceId: agent.id,
          category: 'WORKFORCE',
          severity: 'HIGH',
          ruleKey: 'blocked_app_used',
          title: `Blocked app/site used: ${user.displayName}`,
          message: `${user.displayName} used blocked apps/sites: ${labels.join(', ')}.`,
          dedupeKey: dedupeKey('blocked_app_used', user.id, d),
          metadata: { labels, date: d },
        });
      }
    }

    // 7. lock/unlock/logon... events (deduplicated)
    for (const e of dto.sessionEvents ?? []) {
      const at = new Date(e.at);
      if (Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > MAX_AGE_MS) continue;
      const exists = await this.prisma.clockEvent.findFirst({ where: { userId: user.id, type: e.type, occurredAt: at }, select: { id: true } });
      if (!exists) {
        await this.prisma.clockEvent.create({ data: { userId: user.id, deviceId: agent.id, type: e.type, source: 'AGENT', occurredAt: at } });
      }
      if (!dates.includes(localDate(at, tz))) dates.push(localDate(at, tz));
    }

    // 8. session rollups for affected days
    const latest = fresh.length ? fresh[fresh.length - 1] : null;
    const today = localDate(now, tz);
    if (observedLocation && !dates.includes(today)) dates.push(today); // network-only update refreshes today's location
    for (const d of dates) {
      const isLatestDay = latest && latest.dateStr === d;
      await this.sessions.recompute(user.id, d, {
        policy,
        now,
        deviceId: agent.id,
        observedLocation: d === today ? observedLocation : undefined,
        ...(isLatestDay ? { currentApp: classify({ app: latest!.app, domain: latest!.domain }, (await this.policies.rules()) as RuleLike[], user.departmentId).label } : {}),
      });
    }
    return { accepted, userId: user.id };
  }

  /** `AgentPolicy.workforce` block (docs/WORKFORCE.md "Agent protocol additions"). */
  async buildAgentWorkforce(device: Pick<AgentDevice, 'id' | 'assignedUserId'>, loggedInUser?: string | null): Promise<AgentWorkforcePolicy | null> {
    const user = await this.resolveUser(device, loggedInUser);
    const policy = user ? await this.policies.forDepartment(user.departmentId) : await this.policies.forDepartment(null);
    if (!policy) return null;
    let currentTask: { id: string; title: string } | null = null;
    let clockedOut = false;
    if (user) {
      const [running, today] = await Promise.all([
        this.prisma.timeEntry.findFirst({ where: { userId: user.id, endedAt: null }, include: { task: { select: { id: true, title: true } } } }),
        this.sessions.todayEvents(user.id, policy),
      ]);
      currentTask = running ? { id: running.task.id, title: running.task.title } : null;
      clockedOut = today.state.clockedOut;
    }
    return {
      enabled: policy.trackingEnabled && !!user,
      idleThresholdSec: policy.idleThresholdSec,
      trackApps: policy.trackApps,
      trackWebsites: policy.trackWebsites,
      captureWindowTitles: policy.captureWindowTitles,
      timezone: policy.timezone,
      workDays: policy.workDays,
      workStart: policy.workStart,
      workEnd: policy.workEnd,
      trackOutsideWorkHours: policy.trackOutsideWorkHours,
      screenshots: { enabled: policy.screenshotsEnabled, intervalMin: policy.screenshotIntervalMin, blur: policy.screenshotBlur },
      showTrackingNotice: policy.showTrackingNotice,
      noticeText: trackingNoticeText(policy, await this.policies.companyName()),
      currentTask,
      clockedOut,
    };
  }

  /** Incremental hour-bucket upserts (UTC hours). Meeting time counts as active in buckets. */
  private async updateHourly(userId: string, rows: Prisma.ActivitySegmentCreateManyInput[]) {
    type B = { active: number; idle: number; productive: number; neutral: number; unproductive: number; input: number };
    const buckets = new Map<number, B>();
    for (const r of rows) {
      const s = (r.startedAt as Date).getTime();
      const e = (r.endedAt as Date).getTime();
      const working = r.active || isMeetingLabel(r.appLabel ?? null);
      const bucket = categoryBucket((r.category ?? 'UNCATEGORIZED') as ActivityCategory);
      for (let h = Math.floor(s / 3_600_000) * 3_600_000; h < e; h += 3_600_000) {
        const part = (Math.min(e, h + 3_600_000) - Math.max(s, h)) / 1000;
        if (part <= 0) continue;
        const frac = part / Math.max(1, (e - s) / 1000);
        const b = buckets.get(h) ?? { active: 0, idle: 0, productive: 0, neutral: 0, unproductive: 0, input: 0 };
        if (working) {
          b.active += part;
          b[bucket] += part;
        } else b.idle += part;
        b.input += (r.inputEvents ?? 0) * frac;
        buckets.set(h, b);
      }
    }
    if (!buckets.size) return;
    const values = [...buckets.entries()].map(
      ([h, b]) =>
        Prisma.sql`(gen_random_uuid(), ${userId}::uuid, ${new Date(h)}, ${Math.round(b.active)}, ${Math.round(b.idle)}, ${Math.round(b.productive)}, ${Math.round(b.neutral)}, ${Math.round(b.unproductive)}, ${Math.round(b.input)})`,
    );
    await this.prisma.$executeRaw`
      INSERT INTO activity_hourly (id, user_id, hour, active_sec, idle_sec, productive_sec, neutral_sec, unproductive_sec, input_events)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (user_id, hour) DO UPDATE SET
        active_sec = activity_hourly.active_sec + EXCLUDED.active_sec,
        idle_sec = activity_hourly.idle_sec + EXCLUDED.idle_sec,
        productive_sec = activity_hourly.productive_sec + EXCLUDED.productive_sec,
        neutral_sec = activity_hourly.neutral_sec + EXCLUDED.neutral_sec,
        unproductive_sec = activity_hourly.unproductive_sec + EXCLUDED.unproductive_sec,
        input_events = activity_hourly.input_events + EXCLUDED.input_events`;
    const hours = [...buckets.keys()].map((h) => new Date(h));
    await this.prisma.$executeRaw`
      UPDATE activity_hourly h SET top_app = (
        SELECT s.app_label FROM activity_segments s
        WHERE s.user_id = h.user_id AND s.started_at >= h.hour AND s.started_at < h.hour + interval '1 hour' AND s.app_label IS NOT NULL
        GROUP BY s.app_label ORDER BY SUM(s.duration_sec) DESC LIMIT 1)
      WHERE h.user_id = ${userId}::uuid AND h.hour IN (${Prisma.join(hours)})`;
  }
}
