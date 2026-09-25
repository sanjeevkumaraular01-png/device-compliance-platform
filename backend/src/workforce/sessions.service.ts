import { ConflictException, Injectable } from '@nestjs/common';
import { ClockEventType, Prisma, WorkforcePolicy, WorkLocation, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/types';
import { WorkforcePoliciesService } from './policies.service';
import {
  ActivityMetrics,
  clockState,
  computeActivity,
  computeAttendance,
  computeBreakSec,
  mergeLocation,
  resolveLocation,
} from './core/metrics';
import { dayRange, dbDate, localDate } from './core/time';
import { ClockDto } from './workforce.dto';

export interface RecomputeOptions {
  policy?: WorkforcePolicy;
  final?: boolean;
  now?: Date;
  deviceId?: string | null;
  observedLocation?: WorkLocation;
  currentApp?: string | null;
  currentTaskId?: string | null;
  /** Create an ABSENT/WEEKEND row even without any activity (nightly close). */
  createIfMissing?: boolean;
}

@Injectable()
export class WorkSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: WorkforcePoliciesService,
  ) {}

  /**
   * Recompute a user's WorkSession for local date `dateStr` from stored segments + clock
   * events and upsert it. Days without segments (e.g. imported history) keep their stored
   * activity totals and only get attendance fields recomputed.
   */
  async recompute(userId: string, dateStr: string, opts: RecomputeOptions = {}): Promise<WorkSession | null> {
    const policy = opts.policy ?? (await this.policies.forUser(userId)).policy;
    const now = opts.now ?? new Date();
    const { start, end } = dayRange(dateStr, policy.timezone);
    const [segments, events, existing] = await Promise.all([
      this.prisma.activitySegment.findMany({
        where: { userId, startedAt: { gte: start, lt: end } },
        select: { startedAt: true, endedAt: true, durationSec: true, active: true, category: true, appLabel: true },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.clockEvent.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: 'asc' } }),
      this.prisma.workSession.findUnique({ where: { userId_date: { userId, date: dbDate(dateStr) } } }),
    ]);
    if (!segments.length && !events.length && !existing && !opts.createIfMissing) return null;

    let activity: ActivityMetrics;
    if (segments.length) activity = computeActivity(segments);
    else if (existing) {
      activity = {
        activeSec: existing.activeSec, idleSec: existing.idleSec, productiveSec: existing.productiveSec, neutralSec: existing.neutralSec,
        unproductiveSec: existing.unproductiveSec, meetingSec: existing.meetingSec, focusSec: existing.focusSec,
        firstActivityAt: existing.firstActivityAt, lastActivityAt: existing.lastActivityAt, idleStretches: [],
      };
    } else activity = computeActivity([]);

    const breakSec = segments.length || events.some((e) => e.type === 'BREAK_START') ? computeBreakSec(events, activity.idleStretches, now) : (existing?.breakSec ?? 0);
    const att = computeAttendance({
      dateStr,
      policy,
      metrics: activity,
      clockEvents: events,
      final: !!opts.final,
      now,
      existing: existing
        ? { status: existing.status, clockInAt: existing.clockInAt, clockOutAt: existing.clockOutAt, isManuallyAdjusted: existing.isManuallyAdjusted }
        : null,
    });
    const location = opts.observedLocation ? mergeLocation(existing?.location ?? 'UNKNOWN', opts.observedLocation) : (existing?.location ?? 'UNKNOWN');

    const data = {
      status: att.status,
      location,
      clockInAt: att.clockInAt,
      clockOutAt: att.clockOutAt,
      firstActivityAt: activity.firstActivityAt,
      lastActivityAt: activity.lastActivityAt,
      activeSec: activity.activeSec,
      idleSec: activity.idleSec,
      productiveSec: activity.productiveSec,
      neutralSec: activity.neutralSec,
      unproductiveSec: activity.unproductiveSec,
      meetingSec: activity.meetingSec,
      focusSec: activity.focusSec,
      breakSec,
      lateMinutes: att.lateMinutes,
      earlyLeaveMinutes: att.earlyLeaveMinutes,
      overtimeMinutes: att.overtimeMinutes,
      missingMinutes: att.missingMinutes,
      ...(opts.currentApp !== undefined ? { currentApp: opts.currentApp } : {}),
      ...(opts.currentTaskId !== undefined ? { currentTaskId: opts.currentTaskId } : {}),
      ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
      ...(opts.final ? { closedAt: now } : {}),
    } satisfies Prisma.WorkSessionUncheckedUpdateInput;

    return this.prisma.workSession.upsert({
      where: { userId_date: { userId, date: dbDate(dateStr) } },
      create: { userId, date: dbDate(dateStr), ...data },
      update: data,
    });
  }

  /** Clock-in state at instant `t` from the day's events: last CLOCK_IN/CLOCK_OUT before t. */
  static stateAt(events: { type: ClockEventType; occurredAt: Date; source: string }[], t: Date): 'IN_MANUAL' | 'IN_AUTO' | 'OUT' | 'NONE' {
    let state: 'IN_MANUAL' | 'IN_AUTO' | 'OUT' | 'NONE' = 'NONE';
    for (const e of events) {
      if (e.occurredAt > t) break;
      if (e.type === 'CLOCK_IN') state = e.source === 'AGENT' ? 'IN_AUTO' : 'IN_MANUAL';
      else if (e.type === 'CLOCK_OUT') state = 'OUT';
    }
    return state;
  }

  async todayEvents(userId: string, policy: WorkforcePolicy, now = new Date()) {
    const dateStr = localDate(now, policy.timezone);
    const { start, end } = dayRange(dateStr, policy.timezone);
    const events = await this.prisma.clockEvent.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: 'asc' } });
    return { dateStr, events, state: clockState(events) };
  }

  /** POST /workforce/clock (self). */
  async clock(user: AuthUser, dto: ClockDto, ip: string | null) {
    const { policy } = await this.policies.forUser(user.id);
    const now = new Date();
    const { dateStr, state } = await this.todayEvents(user.id, policy, now);
    const inNow = state.clockedIn && !state.clockedOut;
    switch (dto.type) {
      case 'CLOCK_IN':
        if (inNow) throw new ConflictException('You are already clocked in');
        break;
      case 'CLOCK_OUT':
        if (!inNow) throw new ConflictException('You are not clocked in');
        break;
      case 'BREAK_START':
        if (!inNow) throw new ConflictException('Clock in before starting a break');
        if (state.onBreak) throw new ConflictException('You are already on a break');
        break;
      case 'BREAK_END':
        if (!state.onBreak) throw new ConflictException('You are not on a break');
        break;
    }
    const location = ip ? resolveLocation({ ips: [ip] }, policy.officeNetworks) : 'UNKNOWN';
    await this.prisma.clockEvent.create({
      data: { userId: user.id, type: dto.type, source: 'WEB', location, ipAddress: ip, note: dto.note ?? null, occurredAt: now },
    });
    if (dto.type === 'CLOCK_OUT') await this.stopRunningTimer(user.id, now);
    const session = await this.recompute(user.id, dateStr, {
      policy,
      now,
      observedLocation: dto.type === 'CLOCK_IN' && location === 'OFFICE' ? 'OFFICE' : undefined,
      createIfMissing: true,
      ...(dto.type === 'CLOCK_OUT' ? { currentTaskId: null } : {}),
    });
    return session;
  }

  /** Stop the user's running task timer (if any) at `at`; rolls tracked time up to the task. */
  async stopRunningTimer(userId: string, at = new Date()) {
    const running = await this.prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    if (!running) return null;
    const durationSec = Math.max(0, Math.round((at.getTime() - running.startedAt.getTime()) / 1000));
    const [entry] = await this.prisma.$transaction([
      this.prisma.timeEntry.update({ where: { id: running.id }, data: { endedAt: at, durationSec }, include: { task: { select: { id: true, title: true } } } }),
      this.prisma.workTask.update({ where: { id: running.taskId }, data: { trackedSec: { increment: durationSec } } }),
    ]);
    // Close any other stray running entries (should not exist).
    await this.prisma.timeEntry.updateMany({ where: { userId, endedAt: null }, data: { endedAt: at } });
    return entry;
  }
}
