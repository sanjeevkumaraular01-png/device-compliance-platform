import { isVague, validateReportForSubmit, DailyReportItemInput } from './validation';

const good: DailyReportItemInput = {
  taskTitle: 'Devices API pagination',
  workCompleted: 'Implemented cursor pagination for GET /devices and added e2e tests',
  result: 'PR #412 opened',
};

describe('daily report validation', () => {
  it.each([
    'working on tasks',
    'Worked on stuff and misc things',
    'done done done done done',
    'Same as yesterday, in progress',
    'various tasks, meetings etc',
    'checked emails and follow up',
  ])('rejects vague text: %s', (t) => expect(isVague(t)).toBe(true));

  it.each([
    'Fixed login redirect bug in SSO callback',
    'Called 12 leads from the Q4 webinar list, booked 3 demos',
    'Reconciled September vendor invoices against PO ledger',
    'Resolved tickets #4521 and #4522 (VPN certificate renewal)',
  ])('accepts concrete text: %s', (t) => expect(isVague(t)).toBe(false));

  it('requires at least one item', () => {
    expect(validateReportForSubmit([], { taskStatus: {} })).toEqual(['Add at least one work item before submitting']);
  });

  it('accepts a complete report', () => {
    expect(validateReportForSubmit([good], { taskStatus: {} })).toEqual([]);
  });

  it('returns per-item messages for missing / short / vague fields', () => {
    const errs = validateReportForSubmit(
      [
        good,
        { taskTitle: '', workCompleted: 'short', result: '' },
        { taskTitle: 'Support', workCompleted: 'working on tasks and misc stuff', result: 'ok' },
      ],
      { taskStatus: {} },
    );
    expect(errs).toEqual([
      'Item 2: taskTitle is required',
      'Item 2: workCompleted must be at least 15 characters',
      'Item 2: result is required',
      expect.stringMatching(/^Item 3: workCompleted is too vague/),
    ]);
  });

  it('requires blocker or nextAction when the linked task is not DONE', () => {
    const item = { ...good, taskId: 't1' };
    expect(validateReportForSubmit([item], { taskStatus: { t1: 'IN_PROGRESS' } })).toEqual([
      'Item 1: blocker or nextAction is required because the linked task is not DONE',
    ]);
    expect(validateReportForSubmit([{ ...item, nextAction: 'Address review comments tomorrow' }], { taskStatus: { t1: 'IN_PROGRESS' } })).toEqual([]);
    expect(validateReportForSubmit([item], { taskStatus: { t1: 'DONE' } })).toEqual([]);
  });
});
