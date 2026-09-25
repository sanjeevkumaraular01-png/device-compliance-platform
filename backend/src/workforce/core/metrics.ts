import type { ActivityCategory, AttendanceStatus, ClockEventType, WorkLocation } from '@prisma/client';
import { ipInCidr, isValidCidr } from '../../common/utils/cidr';
import { categoryBucket, isMeetingLabel } from './classifier';
import { isoWeekday, zonedTime } from './time';

/**
 * Pure session / attendance calculations (docs/WORKFORCE.md "Calculations").
 *
 * Conventions:
 *  - `activeSec` excludes meeting time; meeting segments (active or idle) count in
 *    `meetingSec` and never as idle. Worked time = activeSec + meetingSec.
 *  - Category totals (productive/neutral/unproductive) cover active + meeting time.
 *  - Percentages use tracked = activeSec + meetingSec + idleSec.
 */

export interface SegmentLike {
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  active: boolean;
  category: ActivityCategory;
  appLabel: string | null;
}

export interface ClockEventLike {
  type: ClockEventType;
  occurredAt: Date;
  source?: string;
}

export interface SchedulePolicy {
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  graceMinutes: number;
  minDailyMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number;
}

export interface ActivityMetrics {
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  meetingSec: number;
  focusSec: number;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
  /** Idle stretches (merged idle, non-meeting segments). */
  idleStretches: { start: Date; end: Date }[];
}

export const FOCUS_MIN_SEC = 25 * 60;
export const FOCUS_MAX_GAP_SEC = 120;
export const BREAK_IDLE_MIN_SEC = 15 * 60;
export const ONLINE_WINDOW_MS = 3 * 60_000;

export function computeActivity(segments: SegmentLike[]): ActivityMetrics {
  const segs = [...segments].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const m: ActivityMetrics = {
    activeSec: 0, idleSec: 0, productiveSec: 0, neutralSec: 0, unproductiveSec: 0, meetingSec: 0, focusSec: 0,
    firstActivityAt: null, lastActivityAt: null, idleStretches: [],
  };
  let streakSec = 0;
  let streakEnd: number | null = null;
  const closeStreak = () => {
    if (streakSec >= FOCUS_MIN_SEC) m.focusSec += streakSec;
    streakSec = 0;
    streakEnd = null;
  };
  let idleStart: Date | null = null;
  let idleEnd: Date | null = null;
  const closeIdle = () => {
    if (idleStart && idleEnd) m.idleStretches.push({ start: idleStart, end: idleEnd });
    idleStart = idleEnd = null;
  };

  for (const s of segs) {
    const dur = Math.max(0, Math.round(s.durationSec));
    const meeting = isMeetingLabel(s.appLabel);
    const working = s.active || meeting;
    if (working) {
      if (meeting) m.meetingSec += dur;
      else m.activeSec += dur;
      const bucket = categoryBucket(s.category);
      if (bucket === 'productive') m.productiveSec += dur;
      else if (bucket === 'unproductive') m.unproductiveSec += dur;
      else m.neutralSec += dur;
      if (!m.firstActivityAt || s.startedAt < m.firstActivityAt) m.firstActivityAt = s.startedAt;
      if (!m.lastActivityAt || s.endedAt > m.lastActivityAt) m.lastActivityAt = s.endedAt;
      closeIdle();
    } else {
      m.idleSec += dur;
      if (idleEnd && s.startedAt.getTime() - (idleEnd as Date).getTime() <= 60_000) idleEnd = s.endedAt;
      else {
        closeIdle();
        idleStart = s.startedAt;
        idleEnd = s.endedAt;
      }
    }
    // Focus: productive, active, non-meeting streaks >= 25 min with gaps < 2 min.
    if (s.active && !meeting && s.category === 'PRODUCTIVE') {
      if (streakEnd !== null && (s.startedAt.getTime() - streakEnd) / 1000 >= FOCUS_MAX_GAP_SEC) closeStreak();
      streakSec += dur;
      streakEnd = s.endedAt.getTime();
    } else if (streakEnd !== null && (s.endedAt.getTime() - streakEnd) / 1000 >= FOCUS_MAX_GAP_SEC) {
      closeStreak();
    }
  }
  closeStreak();
  closeIdle();
  return m;
}

export interface ClockState {
  /** Explicit or automatic clock-in exists today and no later clock-out. */
  clockedIn: boolean;
  /** Last clock-in/out event today is a CLOCK_OUT. */
  clockedOut: boolean;
  onBreak: boolean;
  firstClockIn: Date | null;
  lastClockOut: Date | null;
}

export function clockState(events: ClockEventLike[]): ClockState {
  const evs = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let clockedIn = false;
  let clockedOut = false;
  let onBreak = false;
  let firstClockIn: Date | null = null;
  let lastClockOut: Date | null = null;
  for (const e of evs) {
    if (e.type === 'CLOCK_IN') {
      clockedIn = true;
      clockedOut = false;
      if (!firstClockIn) firstClockIn = e.occurredAt;
    } else if (e.type === 'CLOCK_OUT') {
      clockedIn = false;
      clockedOut = true;
      onBreak = false;
      lastClockOut = e.occurredAt;
    } else if (e.type === 'BREAK_START') onBreak = true;
    else if (e.type === 'BREAK_END') onBreak = false;
  }
  return { clockedIn, clockedOut, onBreak, firstClockIn, lastClockOut };
}

function overlapSec(a: { start: Date; end: Date }, b: { start: Date; end: Date }): number {
  const s = Math.max(a.start.getTime(), b.start.getTime());
  const e = Math.min(a.end.getTime(), b.end.getTime());
  return Math.max(0, (e - s) / 1000);
}

/** Breaks = BREAK_START..BREAK_END pairs (open break runs until `now`) + idle stretches >= 15 min outside them. */
export function computeBreakSec(events: ClockEventLike[], idleStretches: { start: Date; end: Date }[], now: Date): number {
  const evs = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const breaks: { start: Date; end: Date }[] = [];
  let open: Date | null = null;
  for (const e of evs) {
    if (e.type === 'BREAK_START' && !open) open = e.occurredAt;
    else if ((e.type === 'BREAK_END' || e.type === 'CLOCK_OUT') && open) {
      breaks.push({ start: open, end: e.occurredAt });
      open = null;
    }
  }
  if (open && now > open) breaks.push({ start: open, end: now });
  let total = breaks.reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 1000, 0);
  for (const st of idleStretches) {
    const len = (st.end.getTime() - st.start.getTime()) / 1000;
    if (len < BREAK_IDLE_MIN_SEC) continue;
    const inside = breaks.reduce((s, b) => s + overlapSec(st, b), 0);
    total += Math.max(0, len - inside);
  }
  return Math.round(total);
}

export function isWorkDay(policy: Pick<SchedulePolicy, 'workDays'>, dateStr: string): boolean {
  return policy.workDays.includes(isoWeekday(dateStr));
}

export interface AttendanceInput {
  dateStr: string;
  policy: SchedulePolicy;
  metrics: Pick<ActivityMetrics, 'activeSec' | 'meetingSec' | 'firstActivityAt' | 'lastActivityAt'>;
  clockEvents: ClockEventLike[];
  /** Nightly close: clock-out falls back to last activity; HALF_DAY is decided. */
  final: boolean;
  now: Date;
  /** Preserved values of a manually corrected session / leave / holiday. */
  existing?: {
    status?: AttendanceStatus | null;
    clockInAt?: Date | null;
    clockOutAt?: Date | null;
    isManuallyAdjusted?: boolean;
  } | null;
}

export interface AttendanceResult {
  clockInAt: Date | null;
  clockOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  missingMinutes: number;
  workedMinutes: number;
  status: AttendanceStatus;
}

export function computeAttendance(input: AttendanceInput): AttendanceResult {
  const { dateStr, policy, metrics, final, existing } = input;
  const cs = clockState(input.clockEvents);
  const workday = isWorkDay(policy, dateStr);
  const manual = !!existing?.isManuallyAdjusted;

  let clockInAt = cs.firstClockIn ?? metrics.firstActivityAt ?? null;
  let clockOutAt = cs.clockedOut ? cs.lastClockOut : final ? (metrics.lastActivityAt ?? null) : null;
  if (manual) {
    if (existing?.clockInAt !== undefined) clockInAt = existing.clockInAt ?? clockInAt;
    if (existing?.clockOutAt !== undefined) clockOutAt = existing.clockOutAt ?? clockOutAt;
  }

  const workedMinutes = Math.floor((metrics.activeSec + metrics.meetingSec) / 60);
  const start = zonedTime(dateStr, policy.workStart, policy.timezone);
  const end = zonedTime(dateStr, policy.workEnd, policy.timezone);
  const lateMinutes =
    workday && clockInAt ? Math.max(0, Math.floor((clockInAt.getTime() - (start.getTime() + policy.graceMinutes * 60_000)) / 60_000)) : 0;
  const earlyLeaveMinutes = workday && clockOutAt && clockOutAt < end ? Math.floor((end.getTime() - clockOutAt.getTime()) / 60_000) : 0;
  const overtimeMinutes = Math.max(0, workedMinutes - policy.overtimeAfterMinutes);
  const missingMinutes = workday ? Math.max(0, policy.minDailyMinutes - workedMinutes) : 0;

  const hasActivity = !!clockInAt || workedMinutes > 0;
  let status: AttendanceStatus;
  const kept = existing?.status;
  if (kept === 'ON_LEAVE' || kept === 'HOLIDAY') status = kept;
  else if (manual && kept) status = kept;
  else if (!hasActivity) status = workday ? 'ABSENT' : 'WEEKEND';
  else if (!workday) status = 'PRESENT';
  else if (final && workedMinutes < policy.halfDayMinutes) status = 'HALF_DAY';
  else if (lateMinutes > 0) status = 'LATE';
  else status = 'PRESENT';

  return {
    clockInAt,
    clockOutAt,
    lateMinutes: kept === 'ON_LEAVE' || kept === 'HOLIDAY' ? 0 : lateMinutes,
    earlyLeaveMinutes: kept === 'ON_LEAVE' || kept === 'HOLIDAY' ? 0 : earlyLeaveMinutes,
    overtimeMinutes,
    missingMinutes: kept === 'ON_LEAVE' || kept === 'HOLIDAY' ? 0 : missingMinutes,
    workedMinutes,
    status,
  };
}

/** OFFICE if an agent-reported IP is inside an office CIDR or the SSID matches `ssid:<name>`; REMOTE otherwise; UNKNOWN if nothing reported. */
export function resolveLocation(network: { ips?: string[]; ssid?: string | null } | null | undefined, officeNetworks: string[]): WorkLocation {
  const ips = (network?.ips ?? []).filter(Boolean);
  const ssid = network?.ssid?.trim();
  if (!ips.length && !ssid) return 'UNKNOWN';
  for (const entry of officeNetworks) {
    const e = entry.trim();
    if (e.toLowerCase().startsWith('ssid:')) {
      if (ssid && ssid.toLowerCase() === e.substring(5).trim().toLowerCase()) return 'OFFICE';
    } else if (isValidCidr(e) && ips.some((ip) => ipInCidr(ip, e))) {
      return 'OFFICE';
    }
  }
  return 'REMOTE';
}

/** Merge a newly observed location into the session's location (OFFICE sticks for the day). */
export function mergeLocation(current: WorkLocation, observed: WorkLocation): WorkLocation {
  if (observed === 'OFFICE' || current === 'OFFICE') return 'OFFICE';
  if (observed === 'REMOTE') return 'REMOTE';
  return current;
}

export type LiveStatus = 'ONLINE_ACTIVE' | 'ONLINE_IDLE' | 'ON_BREAK' | 'OFFLINE' | 'CLOCKED_OUT';

export function liveStatus(
  cs: Pick<ClockState, 'clockedOut' | 'onBreak'>,
  lastSegment: { endedAt: Date; active: boolean; appLabel: string | null } | null,
  now: Date,
): LiveStatus {
  if (cs.clockedOut) return 'CLOCKED_OUT';
  if (cs.onBreak) return 'ON_BREAK';
  if (lastSegment && now.getTime() - lastSegment.endedAt.getTime() <= ONLINE_WINDOW_MS) {
    return lastSegment.active || isMeetingLabel(lastSegment.appLabel) ? 'ONLINE_ACTIVE' : 'ONLINE_IDLE';
  }
  return 'OFFLINE';
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Active %, idle %, productive % of a session-like row. */
export function percentages(s: { activeSec: number; meetingSec: number; idleSec: number; productiveSec: number }) {
  const working = s.activeSec + s.meetingSec;
  const tracked = working + s.idleSec;
  return { activePercent: pct(working, tracked), idlePercent: pct(s.idleSec, tracked), productivePercent: pct(s.productiveSec, working) };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
