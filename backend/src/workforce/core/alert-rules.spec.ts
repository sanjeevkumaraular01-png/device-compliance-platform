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
  RulePolicy,
  RuleSession,
  RuleTask,
  workMinutesBetween,
} from './alert-rules';
import { zonedTime } from './time';

const TZ = 'Asia/Kolkata';
const P: RulePolicy = {
  timezone: TZ, workDays: [1, 2, 3, 4, 5], workStart: '09:30', workEnd: '18:30', minDailyMinutes: 480,
  alertLateLogin: true, alertNoActivityMinutes: 30, alertIdlePercent: 40, alertOvertimeMinutes: 120, alertUnproductivePercent: 30,
  requireTaskSelection: true, requireDailyReport: true, dailyReportDueTime: '19:30',
};
const S = (o: Partial<RuleSession> = {}): RuleSession => ({
  activeSec: 4 * 3600, idleSec: 600, meetingSec: 0, productiveSec: 3 * 3600, unproductiveSec: 600, lateMinutes: 0, overtimeMinutes: 0,
  firstActivityAt: null, clockInAt: null, status: 'PRESENT', ...o,
});
const at = (d: string, hm: string) => zonedTime(d, hm, TZ);
const task = (o: Partial<RuleTask>): RuleTask => ({ id: 't', title: 'Task', status: 'IN_PROGRESS', estimatedMinutes: 60, trackedSec: 0, dueDate: null, delayCount: 0, ...o });

describe('workforce alert rules', () => {
  it('late_login (LOW) only when late and enabled', () => {
    expect(evalLateLogin('Ann', P, S({ lateMinutes: 12 }))).toMatchObject({ ruleKey: 'late_login', severity: 'LOW' });
    expect(evalLateLogin('Ann', P, S())).toBeNull();
    expect(evalLateLogin('Ann', { ...P, alertLateLogin: false }, S({ lateMinutes: 12 }))).toBeNull();
  });

  it('no_activity_after_login after the configured minutes', () => {
    const cin = at('2026-09-24', '09:30');
    expect(evalNoActivityAfterLogin('Ann', P, S(), cin, at('2026-09-24', '09:50'))).toBeNull(); // too early to tell
    expect(evalNoActivityAfterLogin('Ann', P, S(), cin, at('2026-09-24', '10:05'))).toMatchObject({ ruleKey: 'no_activity_after_login', severity: 'MEDIUM' });
    expect(evalNoActivityAfterLogin('Ann', P, S({ firstActivityAt: at('2026-09-24', '09:40') }), cin, at('2026-09-24', '10:05'))).toBeNull();
  });

  it('excessive_idle / unproductive_usage thresholds (need >= 1h sample)', () => {
    expect(evalExcessiveIdle('Ann', P, S({ activeSec: 3600, idleSec: 3600 }))).toMatchObject({ ruleKey: 'excessive_idle' });
    expect(evalExcessiveIdle('Ann', P, S({ activeSec: 600, idleSec: 1200 }))).toBeNull();
    expect(evalUnproductiveUsage('Ann', P, S({ activeSec: 7200, unproductiveSec: 3000 }))).toMatchObject({ ruleKey: 'unproductive_usage' });
    expect(evalUnproductiveUsage('Ann', P, S({ activeSec: 7200, unproductiveSec: 600 }))).toBeNull();
  });

  it('blocked_app_used is HIGH', () => {
    expect(evalBlockedApp('Ann', [{ label: 'Torrent sites', seconds: 120 }])).toMatchObject({ severity: 'HIGH', metadata: { labels: ['Torrent sites'] } });
    expect(evalBlockedApp('Ann', [])).toBeNull();
  });

  it('no_task_selected only when required, online and working without a timer', () => {
    expect(evalNoTaskSelected('Ann', P, S(), true, false)).toMatchObject({ severity: 'LOW' });
    expect(evalNoTaskSelected('Ann', P, S(), true, true)).toBeNull();
    expect(evalNoTaskSelected('Ann', { ...P, requireTaskSelection: false }, S(), true, false)).toBeNull();
  });

  it('excessive_overtime and daily_report_missing', () => {
    expect(evalExcessiveOvertime('Ann', P, S({ overtimeMinutes: 150 }))).toMatchObject({ ruleKey: 'excessive_overtime' });
    expect(evalExcessiveOvertime('Ann', P, S({ overtimeMinutes: 60 }))).toBeNull();
    expect(evalReportMissing('Ann', P, '2026-09-24', true, false)).toMatchObject({ ruleKey: 'daily_report_missing', severity: 'MEDIUM' });
    expect(evalReportMissing('Ann', P, '2026-09-24', true, true)).toBeNull();
    expect(evalReportMissing('Ann', P, '2026-09-24', false, false)).toBeNull();
  });

  it('workload_overload: remaining estimates in the next 5 work days > 120% of capacity', () => {
    const due = at('2026-09-28', '18:00');
    const heavy = [task({ id: 'a', estimatedMinutes: 1800, dueDate: due }), task({ id: 'b', estimatedMinutes: 1200, dueDate: due })];
    expect(evalWorkloadOverload('Ann', P, heavy, '2026-09-24')).toMatchObject({ ruleKey: 'workload_overload', severity: 'HIGH' });
    expect(evalWorkloadOverload('Ann', P, [task({ estimatedMinutes: 600, dueDate: due })], '2026-09-24')).toBeNull();
    // tracked time reduces the remaining estimate
    expect(evalWorkloadOverload('Ann', P, heavy.map((t) => ({ ...t, trackedSec: t.estimatedMinutes! * 60 })), '2026-09-24')).toBeNull();
  });

  it('deadline_at_risk: due within 2 days and remaining estimate > remaining work minutes', () => {
    const now = at('2026-09-24', '17:00');
    // due tomorrow 12:00 -> 90 (today) + 150 (tomorrow) = 240 work minutes left
    expect(workMinutesBetween(P, now, at('2026-09-25', '12:00'), '2026-09-24')).toBe(240);
    expect(evalDeadlineAtRisk('Ann', P, [task({ estimatedMinutes: 300, dueDate: at('2026-09-25', '12:00') })], now, '2026-09-24')).toMatchObject({ ruleKey: 'deadline_at_risk', severity: 'HIGH' });
    expect(evalDeadlineAtRisk('Ann', P, [task({ estimatedMinutes: 200, dueDate: at('2026-09-25', '12:00') })], now, '2026-09-24')).toBeNull();
    expect(evalDeadlineAtRisk('Ann', P, [task({ estimatedMinutes: 900, dueDate: at('2026-10-05', '12:00') })], now, '2026-09-24')).toBeNull();
    expect(evalDeadlineAtRisk('Ann', P, [task({ status: 'DONE', estimatedMinutes: 900, dueDate: at('2026-09-25', '12:00') })], now, '2026-09-24')).toBeNull();
  });

  it('repeated_task_delay when delayCount >= 2 on open tasks', () => {
    expect(evalRepeatedTaskDelay('Ann', [task({ delayCount: 2 })])).toMatchObject({ ruleKey: 'repeated_task_delay' });
    expect(evalRepeatedTaskDelay('Ann', [task({ delayCount: 1 }), task({ delayCount: 3, status: 'DONE' })])).toBeNull();
  });

  it('productivity_drop: < 60% of the 14-day median, needs 5 days of history', () => {
    const hist = [70, 72, 68, 75, 71, 69];
    expect(evalProductivityDrop('Ann', 30, hist, 4 * 3600)).toMatchObject({ ruleKey: 'productivity_drop' });
    expect(evalProductivityDrop('Ann', 50, hist, 4 * 3600)).toBeNull();
    expect(evalProductivityDrop('Ann', 10, [70, 70, 70, 70], 4 * 3600)).toBeNull();
    expect(evalProductivityDrop('Ann', 10, hist, 1800)).toBeNull();
  });

  it('dedupe key format', () => {
    expect(dedupeKey('late_login', 'u1', '2026-09-24')).toBe('workforce:late_login:u1:2026-09-24');
  });
});
