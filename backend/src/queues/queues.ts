export const QUEUE_ALERTS = 'alerts';
export const QUEUE_REPORTS = 'reports';
export const QUEUE_COMPLIANCE = 'compliance';
export const QUEUE_MAINTENANCE = 'maintenance';
/** Workforce jobs: live alert rules, nightly close, report-missing, HRMS push, screenshot purge, AI runs. */
export const QUEUE_WORKFORCE = 'workforce';

export const ALL_QUEUES = [QUEUE_ALERTS, QUEUE_REPORTS, QUEUE_COMPLIANCE, QUEUE_MAINTENANCE, QUEUE_WORKFORCE] as const;
