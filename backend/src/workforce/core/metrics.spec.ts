import { clockState, computeActivity, computeAttendance, computeBreakSec, liveStatus, mergeLocation, percentages, resolveLocation, SchedulePolicy, SegmentLike } from './metrics';
import { zonedTime } from './time';

const TZ = 'Asia/Kolkata';
const DATE = '2026-09-24'; // Thursday
const at = (hm: string, date = DATE) => zonedTime(date, hm, TZ);
const policy: SchedulePolicy = {
  timezone: TZ, workDays: [1, 2, 3, 4, 5], workStart: '09:30', workEnd: '18:30', graceMinutes: 15,
  minDailyMinutes: 480, halfDayMinutes: 240, overtimeAfterMinutes: 540,
};

/** Consecutive 5-minute segments from `start` for `minutes`. */
function run(start: string, minutes: number, opts: Partial<SegmentLike> = {}): SegmentLike[] {
  const out: SegmentLike[] = [];
  let t = at(start).getTime();
  for (let m = 0; m < minutes; m += 5) {
    const len = Math.min(5, minutes - m) * 60_000;
    out.push({ startedAt: new Date(t), endedAt: new Date(t + len), durationSec: len / 1000, active: true, category: 'PRODUCTIVE', appLabel: 'VS Code', ...opts });
    t += len;
  }
  return out;
}

describe('session metrics', () => {
  it('splits active / idle / category time; UNCATEGORIZED counts as neutral, BLOCKED as unproductive', () => {
    const segs = [
      ...run('10:00', 60),
      ...run('11:00', 30, { category: 'UNCATEGORIZED', appLabel: 'foo.io' }),
      ...run('11:30', 10, { category: 'BLOCKED', appLabel: 'Torrent sites' }),
      ...run('11:40', 20, { active: false }),
    ];
    const m = computeActivity(segs);
    expect(m.activeSec).toBe(100 * 60);
    expect(m.idleSec).toBe(20 * 60);
    expect(m.productiveSec).toBe(60 * 60);
    expect(m.neutralSec).toBe(30 * 60);
    expect(m.unproductiveSec).toBe(10 * 60);
    expect(m.firstActivityAt).toEqual(at('10:00'));
    expect(m.lastActivityAt).toEqual(at('11:40'));
    expect(percentages({ ...m })).toEqual({ activePercent: 83.3, idlePercent: 16.7, productivePercent: 60 });
  });

  it('meeting segments count as meeting time (never idle), even without input', () => {
    const m = computeActivity([...run('10:00', 30, { active: false, appLabel: 'Meeting: Teams' }), ...run('10:30', 30)]);
    expect(m.meetingSec).toBe(30 * 60);
    expect(m.idleSec).toBe(0);
    expect(m.activeSec).toBe(30 * 60);
    expect(m.productiveSec).toBe(60 * 60);
  });

  it('focus time = productive streaks >= 25 min with gaps < 2 min', () => {
    // 30 min streak -> counts; 20 min streak -> does not; 1-min gap keeps a streak together
    const streak1 = run('10:00', 30);
    const gapThenMore = run('10:31', 15); // gap 1 min -> same streak (45 min total)
    const unrelated = run('12:00', 20);
    expect(computeActivity([...streak1, ...gapThenMore, ...unrelated]).focusSec).toBe(45 * 60);
    // a 5-min unproductive interruption breaks the streak: 20 + 20 -> no focus
    const broken = [...run('14:00', 20), ...run('14:20', 5, { category: 'UNPRODUCTIVE', appLabel: 'YouTube' }), ...run('14:25', 20)];
    expect(computeActivity(broken).focusSec).toBe(0);
  });

  it('breaks = BREAK pairs + idle stretches >= 15 min (not double counted)', () => {
    const segs = [...run('10:00', 60), ...run('11:00', 20, { active: false }), ...run('11:20', 10, { active: false }), ...run('12:00', 10, { active: false })];
    const m = computeActivity(segs);
    expect(m.idleStretches).toHaveLength(2);
    const events = [
      { type: 'BREAK_START' as const, occurredAt: at('11:10') },
      { type: 'BREAK_END' as const, occurredAt: at('11:20') },
    ];
    // idle 11:00-11:30 (30 min, 10 of which inside the break) + break 10 min; 12:00 stretch (10 min) ignored
    expect(computeBreakSec(events, m.idleStretches, at('18:00'))).toBe(30 * 60);
    // open break runs until now
    expect(computeBreakSec([{ type: 'BREAK_START', occurredAt: at('13:00') }], [], at('13:30'))).toBe(30 * 60);
  });

  it('late, early leave, overtime, missing, status', () => {
    const metrics = { activeSec: 500 * 60, meetingSec: 60 * 60, firstActivityAt: at('10:00'), lastActivityAt: at('18:00') };
    const r = computeAttendance({ dateStr: DATE, policy, metrics, clockEvents: [], final: true, now: at('23:59') });
    expect(r.clockInAt).toEqual(at('10:00'));
    expect(r.lateMinutes).toBe(15); // 10:00 - (09:30 + 15)
    expect(r.clockOutAt).toEqual(at('18:00'));
    expect(r.earlyLeaveMinutes).toBe(30);
    expect(r.workedMinutes).toBe(560);
    expect(r.overtimeMinutes).toBe(20);
    expect(r.missingMinutes).toBe(0);
    expect(r.status).toBe('LATE');
  });

  it('explicit CLOCK_IN/OUT win over activity; on time => PRESENT', () => {
    const r = computeAttendance({
      dateStr: DATE, policy, final: false, now: at('19:00'),
      metrics: { activeSec: 470 * 60, meetingSec: 0, firstActivityAt: at('09:50'), lastActivityAt: at('18:40') },
      clockEvents: [{ type: 'CLOCK_IN', occurredAt: at('09:40') }, { type: 'CLOCK_OUT', occurredAt: at('18:45') }],
    });
    expect(r.clockInAt).toEqual(at('09:40'));
    expect(r.clockOutAt).toEqual(at('18:45'));
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyLeaveMinutes).toBe(0);
    expect(r.missingMinutes).toBe(10);
    expect(r.status).toBe('PRESENT');
  });

  it('HALF_DAY only when final; live sessions have no clock-out yet', () => {
    const base = { dateStr: DATE, policy, clockEvents: [], now: at('14:00'), metrics: { activeSec: 120 * 60, meetingSec: 0, firstActivityAt: at('09:35'), lastActivityAt: at('11:35') } };
    const live = computeAttendance({ ...base, final: false });
    expect(live.status).toBe('PRESENT');
    expect(live.clockOutAt).toBeNull();
    expect(computeAttendance({ ...base, final: true }).status).toBe('HALF_DAY');
  });

  it('ABSENT on a work day without activity, WEEKEND otherwise; leave is preserved', () => {
    const none = { activeSec: 0, meetingSec: 0, firstActivityAt: null, lastActivityAt: null };
    expect(computeAttendance({ dateStr: DATE, policy, metrics: none, clockEvents: [], final: true, now: at('23:00') }).status).toBe('ABSENT');
    expect(computeAttendance({ dateStr: '2026-09-26', policy, metrics: none, clockEvents: [], final: true, now: at('23:00') }).status).toBe('WEEKEND');
    const leave = computeAttendance({ dateStr: DATE, policy, metrics: none, clockEvents: [], final: true, now: at('23:00'), existing: { status: 'ON_LEAVE' } });
    expect(leave).toMatchObject({ status: 'ON_LEAVE', missingMinutes: 0, lateMinutes: 0 });
  });

  it('manual corrections keep corrected times and status', () => {
    const r = computeAttendance({
      dateStr: DATE, policy, final: true, now: at('23:00'),
      metrics: { activeSec: 480 * 60, meetingSec: 0, firstActivityAt: at('11:00'), lastActivityAt: at('19:00') },
      clockEvents: [],
      existing: { isManuallyAdjusted: true, clockInAt: at('09:30'), clockOutAt: at('18:30'), status: 'PRESENT' },
    });
    expect(r).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0, status: 'PRESENT' });
  });

  it('clock state tracks clock-out and breaks', () => {
    const s = clockState([
      { type: 'CLOCK_IN', occurredAt: at('09:00') },
      { type: 'BREAK_START', occurredAt: at('13:00') },
    ]);
    expect(s).toMatchObject({ clockedIn: true, onBreak: true, clockedOut: false });
    expect(clockState([{ type: 'CLOCK_IN', occurredAt: at('09:00') }, { type: 'CLOCK_OUT', occurredAt: at('18:00') }]).clockedOut).toBe(true);
  });

  it('location: office CIDR or SSID => OFFICE, else REMOTE, unknown without data; OFFICE sticks', () => {
    const nets = ['10.20.0.0/16', 'ssid:ACME-Corp'];
    expect(resolveLocation({ ips: ['10.20.3.4'] }, nets)).toBe('OFFICE');
    expect(resolveLocation({ ips: ['192.168.1.5'], ssid: 'acme-corp' }, nets)).toBe('OFFICE');
    expect(resolveLocation({ ips: ['192.168.1.5'], ssid: 'HomeWifi' }, nets)).toBe('REMOTE');
    expect(resolveLocation(null, nets)).toBe('UNKNOWN');
    expect(mergeLocation('OFFICE', 'REMOTE')).toBe('OFFICE');
    expect(mergeLocation('UNKNOWN', 'REMOTE')).toBe('REMOTE');
  });

  it('live status: online within 3 minutes, idle when the last segment is idle', () => {
    const now = at('12:00');
    const recent = { endedAt: new Date(now.getTime() - 60_000), active: true, appLabel: 'VS Code' };
    expect(liveStatus({ clockedOut: false, onBreak: false }, recent, now)).toBe('ONLINE_ACTIVE');
    expect(liveStatus({ clockedOut: false, onBreak: false }, { ...recent, active: false }, now)).toBe('ONLINE_IDLE');
    expect(liveStatus({ clockedOut: false, onBreak: false }, { ...recent, active: false, appLabel: 'Meeting: Zoom' }, now)).toBe('ONLINE_ACTIVE');
    expect(liveStatus({ clockedOut: false, onBreak: false }, { ...recent, endedAt: new Date(now.getTime() - 4 * 60_000) }, now)).toBe('OFFLINE');
    expect(liveStatus({ clockedOut: false, onBreak: true }, recent, now)).toBe('ON_BREAK');
    expect(liveStatus({ clockedOut: true, onBreak: false }, recent, now)).toBe('CLOCKED_OUT');
  });
});
