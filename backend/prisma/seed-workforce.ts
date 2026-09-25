/**
 * Workforce seed (docs/WORKFORCE.md), called from seed.ts.
 *
 *  - seedWorkforceBase (always, idempotent): HR_MANAGER permissions for existing roles
 *    (granted once), workforce policies, department assignments, ~80 app/website rules.
 *  - seedWorkforceDemo (SEED_DEMO_DATA, once, guarded by `seed.workforceDemoVersion`):
 *    HR demo user, 6 projects, ~80 tasks, 21 days of sessions + hourly buckets for ~30
 *    employees (raw segments for today and yesterday only), clock events, time entries,
 *    daily reports, workforce alerts and 3 READY AI insights. No screenshots.
 */
import { AlertSeverity, Prisma, PrismaClient, RoleKey, TaskPriority, TaskSource, TaskStatus, WorkforcePolicy } from '@prisma/client';
import { defaultPermissionsFor, WORKFORCE_PERMISSIONS } from '../src/common/permissions';
import { DEFAULT_APP_RULES } from '../src/workforce/default-app-rules';
import { DEMO_APP_MIX, DemoAppPick } from '../src/workforce/demo-app-mix';
import { classify, isMeetingLabel, categoryBucket, RuleLike } from '../src/workforce/core/classifier';
import { computeActivity, computeAttendance, computeBreakSec, isWorkDay, resolveLocation, SegmentLike, pct } from '../src/workforce/core/metrics';
import { addDays, dayRange, dbDate, hmToMinutes, localDate, zonedTime } from '../src/workforce/core/time';
import {
  dedupeKey,
  evalDeadlineAtRisk,
  evalExcessiveIdle,
  evalExcessiveOvertime,
  evalLateLogin,
  evalRepeatedTaskDelay,
  evalReportMissing,
  evalWorkloadOverload,
  RuleFinding,
} from '../src/workforce/core/alert-rules';

export const WORKFORCE_DEMO_VERSION = 1;
const PERMS_MARKER = 'seed.workforcePermsVersion';
const DEMO_MARKER = 'seed.workforceDemoVersion';
export const DEMO_USERS_SETTING = 'seed.workforceDemoUserIds';
const DAY = 86_400_000;

// deterministic PRNG (independent of the core seed's sequence)
let st = 424242;
function rand(): number {
  st |= 0;
  st = (st + 0x6d2b79f5) | 0;
  let t = Math.imul(st ^ (st >>> 15), 1 | st);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

// ─────────────────────────────── Base ───────────────────────────────

export async function seedWorkforceBase(prisma: PrismaClient, depts: Record<string, { id: string }>) {
  // 1. Grant the new workforce permissions to existing roles once (keeps admin edits afterwards).
  const marker = await prisma.systemSetting.findUnique({ where: { key: PERMS_MARKER } });
  if (!marker) {
    for (const role of await prisma.role.findMany()) {
      const add = defaultPermissionsFor(role.key).filter((p) => WORKFORCE_PERMISSIONS.includes(p) || role.key === 'HR_MANAGER');
      const next = [...new Set([...role.permissions, ...add])];
      if (next.length !== role.permissions.length) await prisma.role.update({ where: { id: role.id }, data: { permissions: next } });
    }
    await prisma.systemSetting.create({ data: { key: PERMS_MARKER, value: 1 } });
  }

  // 2. Policies
  const standard = await prisma.workforcePolicy.upsert({
    where: { name: 'Standard Office Hours' },
    create: {
      name: 'Standard Office Hours',
      description: 'Default schedule: Mon-Fri 09:30-18:30, 15 min grace, 8h minimum. Screenshots off, window titles off.',
      isDefault: true,
      officeNetworks: ['10.20.0.0/14', 'ssid:ACME-Corp'],
    },
    update: {},
  });
  if (!(await prisma.workforcePolicy.findFirst({ where: { isDefault: true } }))) {
    await prisma.workforcePolicy.update({ where: { id: standard.id }, data: { isDefault: true } });
  }
  const eng = await prisma.workforcePolicy.upsert({
    where: { name: 'Engineering Flexible' },
    create: {
      name: 'Engineering Flexible',
      description: 'Flexible engineering hours 10:00-19:00 with 30 min grace; focus time matters more than start time.',
      workStart: '10:00',
      workEnd: '19:00',
      graceMinutes: 30,
      overtimeAfterMinutes: 570,
      alertLateLogin: false,
      officeNetworks: ['10.20.0.0/14', 'ssid:ACME-Corp'],
    },
    update: {},
  });
  const support = await prisma.workforcePolicy.upsert({
    where: { name: 'Support Shifts' },
    create: {
      name: 'Support Shifts',
      description: 'Service desk shifts Mon-Sat 08:00-17:00, 10 min grace, task selection required.',
      workDays: [1, 2, 3, 4, 5, 6],
      workStart: '08:00',
      workEnd: '17:00',
      graceMinutes: 10,
      requireTaskSelection: true,
      dailyReportDueTime: '17:30',
      officeNetworks: ['10.26.0.0/16', 'ssid:ACME-Support'],
    },
    update: {},
  });
  if (depts.Engineering) await prisma.department.updateMany({ where: { id: depts.Engineering.id, workforcePolicyId: null }, data: { workforcePolicyId: eng.id } });
  if (depts.IT) await prisma.department.updateMany({ where: { id: depts.IT.id, workforcePolicyId: null }, data: { workforcePolicyId: support.id } });

  // 3. App / website rules
  const codeToDept = new Map<string, string>();
  for (const d of await prisma.department.findMany({ select: { id: true, code: true } })) codeToDept.set(d.code, d.id);
  let created = 0;
  for (const r of DEFAULT_APP_RULES) {
    const departmentId = r.departmentCode ? (codeToDept.get(r.departmentCode) ?? null) : null;
    if (r.departmentCode && !departmentId) continue;
    const exists = await prisma.appRule.findFirst({ where: { kind: r.kind, pattern: r.pattern, departmentId } });
    if (!exists) {
      await prisma.appRule.create({ data: { kind: r.kind, pattern: r.pattern, matchType: r.matchType, label: r.label, category: r.category, departmentId } });
      created++;
    }
  }
  return { policies: { standard, eng, support }, rulesCreated: created };
}

// ─────────────────────────────── Demo ───────────────────────────────

const TASKS: Record<string, { project: string | null; titles: string[] }> = {
  DEVELOPMENT: {
    project: 'PORTAL-V3',
    titles: [
      'Cursor pagination for devices API', 'SSO login redirect loop fix', 'Dark mode for console settings', 'Upgrade Prisma client to v6',
      'Audit log CSV export streaming', 'Rate limiter Redis storage', 'Agent enrollment wizard UI', 'Flaky e2e test in compliance suite',
      'Refactor alert channel config encryption', 'Swagger examples for policies API', 'Password policy validation messages', 'Hourly activity rollup job',
      'Device detail page performance', 'Bulk alert acknowledge endpoint', 'Webhook signature verification docs', 'CI pipeline cache for node_modules',
    ],
  },
  SALES_CRM: {
    project: 'SALES-Q4',
    titles: [
      'Follow up: Globex renewal', 'Proposal for Initech (250 seats)', 'Demo for Umbrella Corp IT team', 'Qualify webinar leads batch 3',
      'Pricing approval for Stark Industries', 'Update CRM pipeline stages', 'Contract redlines with Wayne Enterprises', 'QBR deck: Acme Retail',
      'Cold outreach: healthcare vertical', 'Partner referral follow-ups', 'Renewal risk review: Hooli', 'RFP response: City Hospital',
    ],
  },
  SUPPORT: {
    project: 'SUP-EXC',
    titles: [
      'Ticket #4521 VPN certificate renewal', 'Ticket #4533 Outlook profile corruption', 'Ticket #4540 printer mapping for Finance',
      'Ticket #4555 MFA reset requests', 'Knowledge base: BitLocker recovery steps', 'Ticket #4561 slow laptop (disk health)',
      'Ticket #4570 shared mailbox access', 'SLA report for September', 'Ticket #4588 Teams audio issues', 'Ticket #4592 WHMCS invoice sync',
      'Ticket #4597 Zendesk macro cleanup', 'Ticket #4601 new joiner accounts',
    ],
  },
  FINANCE: {
    project: 'FIN-CLOSE',
    titles: [
      'September vendor invoice reconciliation', 'Payroll variance analysis', 'Prepaid expenses schedule', 'Audit PBC list: fixed assets',
      'GST return filing data', 'Budget vs actual report Q3', 'Expense claim exceptions review', 'Bank reconciliation: operating account', 'Intercompany settlement',
    ],
  },
  HR: {
    project: null,
    titles: ['Screen candidates: Senior Backend Engineer', 'Onboarding plan for October joiners', 'Update leave policy document', 'Exit interview summary Q3', 'Benefits enrollment reminders', 'Performance review calendar'],
  },
  MARKETING: {
    project: 'MKT-BRAND',
    titles: ['Newsletter October draft', 'Landing page banner refresh', 'Case study: Globex deployment', 'Webinar deck: zero-trust endpoints', 'Social calendar for Q4', 'Brand guidelines v2 review'],
  },
  HARDWARE: {
    project: null,
    titles: ['Image 6 laptops for October joiners', 'Replace battery: FIN-WIN-GT12', 'Docking station inventory audit', 'Dispose retired devices (certificate of destruction)', 'Warranty claims for 3 Dell Latitudes'],
  },
  NETWORK: {
    project: 'NET-UPG',
    titles: ['Core switch firmware upgrade', 'Wi-Fi survey floor 3', 'Firewall rule review Q3', 'VPN concentrator capacity test', 'VLAN segmentation for lab devices', 'Replace access point AP-3F-07'],
  },
  OTHER: {
    project: null,
    titles: ['Review NDA template', 'Vendor contract review: cloud hosting', 'Data processing agreement update', 'Policy attestation tracking'],
  },
};

const SOURCE_DEPTS: Record<string, string[]> = {
  DEVELOPMENT: ['Engineering'], SALES_CRM: ['Sales'], SUPPORT: ['IT', 'Operations'], FINANCE: ['Finance'], HR: ['Human Resources'],
  MARKETING: ['Sales', 'Operations'], HARDWARE: ['IT'], NETWORK: ['IT'], OTHER: ['Legal'],
};

const WORK_TEXT: Record<string, { done: string[]; result: string[] }> = {
  DEVELOPMENT: {
    done: ['Implemented the API changes for {t} and added unit tests for edge cases', 'Fixed the root cause behind {t}; verified locally and in staging', 'Reviewed two pull requests related to {t} and addressed review comments'],
    result: ['PR #{n} opened for review', 'PR #{n} merged to main', 'Deployed to staging, QA sign-off pending'],
  },
  SALES_CRM: {
    done: ['Called {k} leads for {t}, qualified {j} opportunities in Salesforce', 'Prepared proposal and pricing sheet for {t}', 'Ran product demo and captured follow-up questions for {t}'],
    result: ['{j} demos booked', 'Proposal sent to customer', 'Opportunity moved to negotiation stage'],
  },
  SUPPORT: {
    done: ['Resolved {t} after remote session; documented fix in the knowledge base', 'Triaged {k} tickets in Zendesk and escalated {j} to L2 ({t})', 'Worked on {t}: reproduced issue, applied fix, confirmed with user'],
    result: ['Ticket closed, user confirmed', '{k} tickets closed within SLA', 'Escalated with full logs attached'],
  },
  FINANCE: {
    done: ['Reconciled {k} line items for {t} against the ledger', 'Prepared working papers for {t} and shared with controller', 'Updated the {t} schedule with September actuals'],
    result: ['Variance under 0.5%, sent for approval', 'Working papers uploaded to audit folder', 'Schedule reviewed by controller'],
  },
  HR: {
    done: ['Screened {k} CVs for {t} and scheduled {j} interviews', 'Drafted and circulated the {t} document for feedback', 'Coordinated with IT and managers on {t}'],
    result: ['{j} interviews scheduled', 'Draft shared with leadership', 'Checklist completed for all joiners'],
  },
  MARKETING: {
    done: ['Drafted copy and visuals for {t}', 'Updated assets for {t} based on brand review feedback', 'Coordinated design review for {t}'],
    result: ['Draft ready for review', 'Assets published', 'Feedback incorporated'],
  },
  HARDWARE: {
    done: ['Imaged and configured {k} laptops for {t}', 'Completed hardware checks for {t} and updated asset records', 'Raised vendor cases for {t}'],
    result: ['{k} devices ready for handover', 'Asset register updated', 'Vendor RMA numbers received'],
  },
  NETWORK: {
    done: ['Completed change window for {t}; validated routing and monitoring', 'Surveyed and documented findings for {t}', 'Reviewed {k} firewall rules for {t} and removed {j} stale ones'],
    result: ['Change closed without incident', 'Report shared with IT manager', '{j} rules removed'],
  },
  OTHER: {
    done: ['Reviewed and marked up {t}; sent comments to counterparty', 'Compared {t} against the updated template and flagged {j} deviations'],
    result: ['Comments sent', 'Awaiting counterparty response'],
  },
};

const fill = (s: string, t: string) => s.replace('{t}', t).replace('{n}', String(int(300, 520))).replace('{k}', String(int(3, 14))).replace('{j}', String(int(1, 4)));

interface DemoUser {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  departmentId: string | null;
  deptName: string;
  deptCode: string;
  deviceId: string | null;
  ip: string | null;
  policy: WorkforcePolicy;
  profile: 'normal' | 'idle' | 'overtime' | 'late' | 'blocked';
}

interface TaskRow {
  id: string;
  title: string;
  source: TaskSource;
  status: TaskStatus;
  estimatedMinutes: number | null;
  dueDate: Date | null;
  delayCount: number;
  assigneeId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  trackedSec: number;
  projectName: string | null;
}

function weightedPick(mix: DemoAppPick[]): DemoAppPick {
  const total = mix.reduce((a, b) => a + b.weight, 0);
  let x = rand() * total;
  for (const m of mix) if ((x -= m.weight) <= 0) return m;
  return mix[mix.length - 1];
}

export async function seedWorkforceDemo(prisma: PrismaClient, opts: { domain: string; pwHash: string; now: Date }) {
  const { domain, pwHash, now } = opts;
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r])) as unknown as Record<RoleKey, { id: string }>;
  const depts = await prisma.department.findMany({ select: { id: true, name: true, code: true, managerId: true, workforcePolicyId: true } });
  const deptById = new Map(depts.map((d) => [d.id, d]));
  const deptByName = new Map(depts.map((d) => [d.name, d]));
  const policies = await prisma.workforcePolicy.findMany();
  const defaultPolicy = policies.find((p) => p.isDefault) ?? policies[0];
  const policyFor = (deptId: string | null) => {
    const pid = deptId ? deptById.get(deptId)?.workforcePolicyId : null;
    return policies.find((p) => p.id === pid) ?? defaultPolicy;
  };

  // HR demo user
  const hrDept = deptByName.get('Human Resources');
  const hr = await prisma.user.upsert({
    where: { email: `hr@${domain}` },
    create: { email: `hr@${domain}`, displayName: 'Nisha Rao', roleId: roles.HR_MANAGER.id, departmentId: hrDept?.id ?? null, jobTitle: 'HR Manager', passwordHash: pwHash, passwordChangedAt: new Date(now.getTime() - 20 * DAY) },
    update: {},
  });

  // Demo employees: seeded employees (phone +1 555 01xx) + employee@ + manager@
  const candidates = await prisma.user.findMany({
    where: { isActive: true, OR: [{ phone: { startsWith: '+1 555 01' } }, { email: { in: [`employee@${domain}`, `manager@${domain}`] } }] },
    select: {
      id: true, email: true, displayName: true, jobTitle: true, departmentId: true,
      assignedDevices: { where: { status: { not: 'RETIRED' } }, select: { id: true, ipAddress: true }, take: 1 },
    },
    orderBy: { email: 'asc' },
  });
  if (!candidates.length) return { users: 0 };
  const users: DemoUser[] = candidates.map((u, i) => {
    const d = u.departmentId ? deptById.get(u.departmentId) : undefined;
    const profile: DemoUser['profile'] = i === 3 ? 'idle' : i === 7 ? 'overtime' : i === 11 ? 'late' : d?.code === 'SALES' && i % 5 === 1 ? 'blocked' : 'normal';
    return {
      id: u.id, email: u.email, displayName: u.displayName, jobTitle: u.jobTitle, departmentId: u.departmentId,
      deptName: d?.name ?? 'Operations', deptCode: d?.code ?? 'OPS', deviceId: u.assignedDevices[0]?.id ?? null, ip: u.assignedDevices[0]?.ipAddress ?? null,
      policy: policyFor(u.departmentId), profile,
    };
  });
  const employeeUser = users.find((u) => u.email === `employee@${domain}`);

  // ── Projects ──
  const byName = (n: string) => deptByName.get(n)?.id ?? null;
  const projectSpecs = [
    { code: 'PORTAL-V3', name: 'Customer Portal v3', dept: 'Engineering', client: null, budget: 1800, status: 'ACTIVE' as const },
    { code: 'SALES-Q4', name: 'Q4 Enterprise Sales Push', dept: 'Sales', client: 'Multiple accounts', budget: 1200, status: 'ACTIVE' as const },
    { code: 'SUP-EXC', name: 'Support Excellence', dept: 'IT', client: null, budget: 900, status: 'ACTIVE' as const },
    { code: 'MKT-BRAND', name: 'Brand Refresh 2026', dept: 'Operations', client: null, budget: 400, status: 'ACTIVE' as const },
    { code: 'NET-UPG', name: 'Network Upgrade', dept: 'IT', client: null, budget: 600, status: 'ACTIVE' as const },
    { code: 'FIN-CLOSE', name: 'FY26 Q3 Close & Audit', dept: 'Finance', client: null, budget: 500, status: 'ACTIVE' as const },
  ];
  const projects = new Map<string, { id: string; name: string }>();
  for (const p of projectSpecs) {
    const deptId = byName(p.dept);
    const owner = deptId ? deptById.get(deptId)?.managerId : null;
    const row = await prisma.project.upsert({
      where: { code: p.code },
      create: {
        code: p.code, name: p.name, departmentId: deptId, ownerId: owner ?? null, clientName: p.client, status: p.status, budgetHours: p.budget,
        startDate: dbDate(localDate(new Date(now.getTime() - 40 * DAY), 'UTC')), dueDate: dbDate(localDate(new Date(now.getTime() + 45 * DAY), 'UTC')),
        description: `${p.name} (demo project)`,
      },
      update: {},
    });
    projects.set(p.code, { id: row.id, name: row.name });
  }

  // ── Tasks (~80) ──
  const tasks: TaskRow[] = [];
  const statuses: [TaskStatus, number][] = [['DONE', 33], ['IN_PROGRESS', 35], ['TODO', 16], ['IN_REVIEW', 8], ['BLOCKED', 5], ['CANCELLED', 3]];
  const pickStatus = () => {
    const total = statuses.reduce((a, b) => a + b[1], 0);
    let x = rand() * total;
    for (const [s, w] of statuses) if ((x -= w) <= 0) return s;
    return 'TODO' as TaskStatus;
  };
  let ref = 1000;
  for (const [source, spec] of Object.entries(TASKS)) {
    const pool = users.filter((u) => SOURCE_DEPTS[source].includes(u.deptName));
    const assignees = pool.length ? pool : users;
    for (const title of spec.titles) {
      const assignee = pick(assignees);
      const status = pickStatus();
      const createdAt = new Date(now.getTime() - int(8, 25) * DAY);
      const est = pick([60, 90, 120, 180, 240, 300, 480, 600, 900]);
      let due: Date | null = new Date(now.getTime() + int(-8, 14) * DAY);
      due = zonedTime(localDate(due, assignee.policy.timezone), '18:00', assignee.policy.timezone);
      const delayCount = chance(0.14) ? int(1, 3) : 0;
      const completedAt = status === 'DONE' ? new Date(now.getTime() - int(1, 12) * DAY) : null;
      const priority: TaskPriority = pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'URGENT']);
      const project = spec.project ? projects.get(spec.project)! : null;
      const row = await prisma.workTask.upsert({
        where: { source_externalRef: { source: source as TaskSource, externalRef: `DEMO-${source}-${ref}` } },
        create: {
          title, source: source as TaskSource, externalRef: `DEMO-${source}-${ref}`, projectId: project?.id ?? null, assigneeId: assignee.id,
          createdById: deptById.get(assignee.departmentId ?? '')?.managerId ?? hr.id, status, priority, estimatedMinutes: est, dueDate: due,
          startedAt: status !== 'TODO' ? new Date(createdAt.getTime() + DAY) : null, completedAt, delayCount, createdAt,
          description: `Demo task imported from ${source.replace('_', ' ').toLowerCase()}.`,
        },
        update: {},
      });
      ref++;
      tasks.push({ id: row.id, title, source: source as TaskSource, status, estimatedMinutes: est, dueDate: due, delayCount, assigneeId: assignee.id, completedAt, createdAt, trackedSec: 0, projectName: project?.name ?? null });
    }
  }
  // Two deadline-at-risk tasks for the employee demo account
  if (employeeUser) {
    for (const [title, est] of [['Release notes + migration guide for v3.2', 900], ['Fix agent heartbeat retry storm', 720]] as const) {
      const due = zonedTime(addDays(localDate(now, employeeUser.policy.timezone), 1), '12:00', employeeUser.policy.timezone);
      const row = await prisma.workTask.upsert({
        where: { source_externalRef: { source: 'DEVELOPMENT', externalRef: `DEMO-RISK-${title.length}` } },
        create: { title, source: 'DEVELOPMENT', externalRef: `DEMO-RISK-${title.length}`, projectId: projects.get('PORTAL-V3')!.id, assigneeId: employeeUser.id, status: 'IN_PROGRESS', priority: 'URGENT', estimatedMinutes: est, dueDate: due, delayCount: 2, createdAt: new Date(now.getTime() - 9 * DAY), startedAt: new Date(now.getTime() - 8 * DAY) },
        update: {},
      });
      tasks.push({ id: row.id, title, source: 'DEVELOPMENT', status: 'IN_PROGRESS', estimatedMinutes: est, dueDate: due, delayCount: 2, assigneeId: employeeUser.id, completedAt: null, createdAt: new Date(now.getTime() - 9 * DAY), trackedSec: 0, projectName: 'Customer Portal v3' });
    }
  }

  // ── Activity ──
  const rules = (await prisma.appRule.findMany()) as RuleLike[];
  const sessions: Prisma.WorkSessionCreateManyInput[] = [];
  const hourly = new Map<string, { userId: string; hour: Date; activeSec: number; idleSec: number; productiveSec: number; neutralSec: number; unproductiveSec: number; inputEvents: number; apps: Map<string, number> }>();
  const segmentsOut: Prisma.ActivitySegmentCreateManyInput[] = [];
  const clockEvents: Prisma.ClockEventCreateManyInput[] = [];
  const timeEntries: Prisma.TimeEntryCreateManyInput[] = [];
  const reports: { userId: string; date: string; status: 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DRAFT'; vague: boolean; tasks: { t: TaskRow; minutes: number }[]; activeMin: number; reviewerId: string | null }[] = [];
  const sessionFacts: { user: DemoUser; date: string; lateMinutes: number; overtimeMinutes: number; activeSec: number; idleSec: number; meetingSec: number; productiveSec: number; unproductiveSec: number; status: string; firstActivityAt: Date | null; worked: boolean; reportSubmitted: boolean }[] = [];
  const blockedUses: { user: DemoUser; date: string; label: string }[] = [];
  const DAYS = 21;

  for (const u of users) {
    const p = u.policy;
    const tz = p.timezone;
    const today = localDate(now, tz);
    const mix = DEMO_APP_MIX[u.deptCode] ?? DEMO_APP_MIX.OPS;
    const myTasks = tasks.filter((t) => t.assigneeId === u.id && t.status !== 'CANCELLED');
    for (let back = DAYS; back >= 0; back--) {
      const date = addDays(today, -back);
      const isToday = back === 0;
      const workday = isWorkDay(p, date);
      if (!workday) {
        if (chance(0.05) && !isToday) {
          // occasional weekend catch-up: short session
        } else {
          sessions.push({ userId: u.id, date: dbDate(date), status: 'WEEKEND', closedAt: isToday ? null : new Date(dayRange(date, tz).end.getTime() + 3_600_000) });
          continue;
        }
      }
      const r = rand();
      if (workday && !isToday && r < 0.03) {
        sessions.push({ userId: u.id, date: dbDate(date), status: 'ON_LEAVE', isManuallyAdjusted: true, adjustmentNote: 'Leave: planned vacation', adjustedById: hr.id, closedAt: new Date(dayRange(date, tz).end.getTime() + 3_600_000) });
        continue;
      }
      if (workday && !isToday && r < 0.065) {
        sessions.push({ userId: u.id, date: dbDate(date), status: 'ABSENT', missingMinutes: p.minDailyMinutes, closedAt: new Date(dayRange(date, tz).end.getTime() + 3_600_000) });
        continue;
      }
      // start / end
      const lateBias = u.profile === 'late' ? int(20, 70) : chance(0.12) ? int(p.graceMinutes + 3, p.graceMinutes + 50) : int(-20, Math.max(0, p.graceMinutes - 3));
      const startMin = hmToMinutes(p.workStart) + (workday ? lateBias : int(60, 180));
      const endMin = workday ? hmToMinutes(p.workEnd) + (u.profile === 'overtime' ? int(90, 180) : int(-35, 55)) : startMin + int(90, 180);
      const dayStart = zonedTime(date, '00:00', tz).getTime();
      let t = dayStart + startMin * 60_000;
      let end = dayStart + endMin * 60_000;
      if (isToday) {
        if (t > now.getTime() - 10 * 60_000) continue; // not started yet today
        end = Math.min(end, now.getTime() - int(0, 90) * 1000);
      }
      const lunchStart = dayStart + (13 * 60 + int(0, 50)) * 60_000;
      const lunchEnd = lunchStart + int(30, 50) * 60_000;
      const meetings: [number, number][] = [];
      for (let m = 0; m < int(0, 2); m++) {
        const ms = dayStart + (hmToMinutes(p.workStart) + int(30, 420)) * 60_000;
        meetings.push([ms, ms + pick([30, 30, 45, 60]) * 60_000]);
      }
      const meetingApp = pick(['Teams', 'Teams', 'Zoom']);
      const segs: (SegmentLike & { app: string | null; domain: string | null; inputEvents: number; category: SegmentLike['category'] })[] = [];
      let blockedToday = false;
      while (t < end) {
        let len = int(2, 5) * 60_000;
        let active = true;
        let app: DemoAppPick;
        const inMeeting = meetings.find(([a, b]) => t >= a && t < b);
        if (t >= lunchStart && t < lunchEnd) {
          active = false;
          app = { app: 'explorer', weight: 1 };
          len = Math.min(len, lunchEnd - t) || len;
        } else if (inMeeting) {
          app = { app: meetingApp, weight: 1 };
          active = chance(0.4);
          len = Math.min(len, inMeeting[1] - t) || len;
        } else {
          app = weightedPick(mix);
          const idleP = u.profile === 'idle' ? 0.42 : 0.1;
          if (chance(idleP)) active = false;
          if (u.profile === 'blocked' && back === 1 && !blockedToday && chance(0.08)) {
            app = { app: 'chrome', domain: 'thepiratebay.org', weight: 1 };
            blockedToday = true;
          }
        }
        len = Math.max(30_000, Math.min(len, end - t));
        if (len <= 0) break;
        const cls = classify({ app: app.app, domain: app.domain ?? null }, rules, u.departmentId);
        if (cls.category === 'BLOCKED') blockedUses.push({ user: u, date, label: cls.label ?? 'blocked' });
        segs.push({
          startedAt: new Date(t), endedAt: new Date(t + len), durationSec: Math.round(len / 1000), active, category: cls.category, appLabel: cls.label,
          app: app.app, domain: app.domain ?? null, inputEvents: active ? int(40, 480) : 0,
        });
        t += len;
      }
      if (!segs.length) continue;
      const metrics = computeActivity(segs);
      // clock events
      const events: Prisma.ClockEventCreateManyInput[] = [];
      const first = metrics.firstActivityAt!;
      const web = chance(0.3);
      events.push({ userId: u.id, deviceId: u.deviceId, type: 'CLOCK_IN', source: web ? 'WEB' : 'AGENT', occurredAt: web ? new Date(first.getTime() - int(1, 6) * 60_000) : first, location: 'UNKNOWN', note: web ? null : 'Automatic (first activity of the day)' });
      if (chance(0.5) && lunchStart < end && lunchStart > first.getTime()) {
        events.push({ userId: u.id, type: 'BREAK_START', source: 'WEB', occurredAt: new Date(lunchStart) });
        if (lunchEnd < end) events.push({ userId: u.id, type: 'BREAK_END', source: 'WEB', occurredAt: new Date(lunchEnd) });
      }
      if (!isToday && chance(0.45)) events.push({ userId: u.id, type: 'CLOCK_OUT', source: 'WEB', occurredAt: new Date(metrics.lastActivityAt!.getTime() + int(1, 5) * 60_000) });
      events.push({ userId: u.id, deviceId: u.deviceId, type: 'LOCK', source: 'AGENT', occurredAt: new Date(lunchStart + 60_000) });
      const location = u.ip ? resolveLocation({ ips: [chance(0.25) ? `192.168.1.${int(2, 200)}` : u.ip] }, p.officeNetworks) : 'UNKNOWN';
      for (const e of events) e.location = location;
      clockEvents.push(...events);

      const att = computeAttendance({ dateStr: date, policy: p, metrics, clockEvents: events.map((e) => ({ type: e.type, occurredAt: e.occurredAt as Date })), final: !isToday, now });
      const breakSec = computeBreakSec(events.map((e) => ({ type: e.type, occurredAt: e.occurredAt as Date })), metrics.idleStretches, isToday ? now : new Date(end));

      // time entries: split the day into 1-3 task windows
      const eligible = myTasks.filter((tk) => tk.createdAt.getTime() < dayStart + DAY && (!tk.completedAt || tk.completedAt.getTime() > dayStart));
      const dayTasks = eligible.length ? [...eligible].sort(() => rand() - 0.5).slice(0, int(1, Math.min(3, eligible.length))) : [];
      const dayTaskMinutes: { t: TaskRow; minutes: number }[] = [];
      let currentTaskId: string | null = null;
      if (dayTasks.length) {
        const s0 = first.getTime();
        const s1 = metrics.lastActivityAt!.getTime();
        const step = (s1 - s0) / dayTasks.length;
        dayTasks.forEach((tk, i) => {
          const a = s0 + i * step;
          const b = i === dayTasks.length - 1 ? s1 : s0 + (i + 1) * step;
          const running = isToday && i === dayTasks.length - 1 && chance(0.55) && tk.status !== 'DONE';
          const dur = Math.round((b - a) / 1000);
          timeEntries.push({ userId: u.id, taskId: tk.id, startedAt: new Date(a), endedAt: running ? null : new Date(b), durationSec: running ? 0 : dur, source: 'TIMER' });
          if (!running) tk.trackedSec += dur;
          else currentTaskId = tk.id;
          dayTaskMinutes.push({ t: tk, minutes: Math.round(dur / 60) });
          if (back <= 1) for (const sg of segs) if (sg.startedAt.getTime() >= a && sg.startedAt.getTime() < b) (sg as { taskId?: string }).taskId = tk.id;
        });
      }

      // raw segments only for today + yesterday; hourly buckets for every day
      if (back <= 1 && u.deviceId) {
        for (const sg of segs) {
          segmentsOut.push({
            userId: u.id, deviceId: u.deviceId, startedAt: sg.startedAt, endedAt: sg.endedAt, durationSec: sg.durationSec, active: sg.active, app: sg.app,
            appLabel: sg.appLabel, domain: sg.domain, category: sg.category, inputEvents: sg.inputEvents, taskId: (sg as { taskId?: string }).taskId ?? null,
          });
        }
      }
      for (const sg of segs) {
        const s = sg.startedAt.getTime();
        const e = sg.endedAt.getTime();
        const working = sg.active || isMeetingLabel(sg.appLabel);
        const bucket = categoryBucket(sg.category);
        for (let h = Math.floor(s / 3_600_000) * 3_600_000; h < e; h += 3_600_000) {
          const part = (Math.min(e, h + 3_600_000) - Math.max(s, h)) / 1000;
          if (part <= 0) continue;
          const key = `${u.id}:${h}`;
          const b = hourly.get(key) ?? { userId: u.id, hour: new Date(h), activeSec: 0, idleSec: 0, productiveSec: 0, neutralSec: 0, unproductiveSec: 0, inputEvents: 0, apps: new Map() };
          if (working) {
            b.activeSec += part;
            if (bucket === 'productive') b.productiveSec += part;
            else if (bucket === 'unproductive') b.unproductiveSec += part;
            else b.neutralSec += part;
            if (sg.appLabel) b.apps.set(sg.appLabel, (b.apps.get(sg.appLabel) ?? 0) + part);
          } else b.idleSec += part;
          b.inputEvents += Math.round(sg.inputEvents * (part / Math.max(1, sg.durationSec)));
          hourly.set(key, b);
        }
      }

      const last = segs[segs.length - 1];
      sessions.push({
        userId: u.id, date: dbDate(date), status: att.status, location, clockInAt: att.clockInAt, clockOutAt: att.clockOutAt,
        firstActivityAt: metrics.firstActivityAt, lastActivityAt: metrics.lastActivityAt, activeSec: metrics.activeSec, idleSec: metrics.idleSec,
        productiveSec: metrics.productiveSec, neutralSec: metrics.neutralSec, unproductiveSec: metrics.unproductiveSec, meetingSec: metrics.meetingSec,
        focusSec: metrics.focusSec, breakSec, lateMinutes: att.lateMinutes, earlyLeaveMinutes: att.earlyLeaveMinutes, overtimeMinutes: att.overtimeMinutes,
        missingMinutes: att.missingMinutes, currentApp: isToday ? last.appLabel : null, currentTaskId: isToday ? currentTaskId : null, deviceId: u.deviceId,
        closedAt: isToday ? null : new Date(dayRange(date, tz).end.getTime() + 3_600_000),
      });

      // daily report
      let reportSubmitted = false;
      if (p.requireDailyReport && !isToday) {
        const rr = rand();
        const reviewer = deptById.get(u.departmentId ?? '')?.managerId ?? hr.id;
        if (rr < 0.8) {
          const status = back > 2 && rr < 0.5 ? 'APPROVED' : back > 2 && rr < 0.53 ? 'CHANGES_REQUESTED' : 'SUBMITTED';
          reports.push({ userId: u.id, date, status, vague: false, tasks: dayTaskMinutes, activeMin: Math.round((metrics.activeSec + metrics.meetingSec) / 60), reviewerId: status === 'SUBMITTED' ? null : reviewer === u.id ? hr.id : reviewer });
          reportSubmitted = true;
        } else if (rr < 0.88) {
          reports.push({ userId: u.id, date, status: 'DRAFT', vague: true, tasks: dayTaskMinutes, activeMin: Math.round((metrics.activeSec + metrics.meetingSec) / 60), reviewerId: null });
        }
      }
      sessionFacts.push({ user: u, date, lateMinutes: att.lateMinutes, overtimeMinutes: att.overtimeMinutes, activeSec: metrics.activeSec, idleSec: metrics.idleSec, meetingSec: metrics.meetingSec, productiveSec: metrics.productiveSec, unproductiveSec: metrics.unproductiveSec, status: att.status, firstActivityAt: metrics.firstActivityAt, worked: true, reportSubmitted });
    }
  }

  // persist activity
  for (let i = 0; i < sessions.length; i += 1000) await prisma.workSession.createMany({ data: sessions.slice(i, i + 1000), skipDuplicates: true });
  const hourlyRows: Prisma.ActivityHourlyCreateManyInput[] = [...hourly.values()].map((b) => ({
    userId: b.userId, hour: b.hour, activeSec: Math.round(b.activeSec), idleSec: Math.round(b.idleSec), productiveSec: Math.round(b.productiveSec),
    neutralSec: Math.round(b.neutralSec), unproductiveSec: Math.round(b.unproductiveSec), inputEvents: b.inputEvents,
    topApp: [...b.apps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
  }));
  for (let i = 0; i < hourlyRows.length; i += 2000) await prisma.activityHourly.createMany({ data: hourlyRows.slice(i, i + 2000), skipDuplicates: true });
  for (let i = 0; i < segmentsOut.length; i += 2000) await prisma.activitySegment.createMany({ data: segmentsOut.slice(i, i + 2000) });
  for (let i = 0; i < clockEvents.length; i += 2000) await prisma.clockEvent.createMany({ data: clockEvents.slice(i, i + 2000) });
  for (let i = 0; i < timeEntries.length; i += 2000) await prisma.timeEntry.createMany({ data: timeEntries.slice(i, i + 2000) });
  for (const t of tasks) if (t.trackedSec) await prisma.workTask.update({ where: { id: t.id }, data: { trackedSec: t.trackedSec } });

  // daily reports
  let reportCount = 0;
  for (const r of reports) {
    const at = zonedTime(r.date, pick(['18:40', '19:05', '19:20', '19:45', '20:10']), users.find((u) => u.id === r.userId)!.policy.timezone);
    const items = r.vague
      ? [{ taskTitle: r.tasks[0]?.t.title ?? 'General', workCompleted: pick(['working on tasks', 'misc work, meetings etc', 'same as yesterday']), result: 'done', sortOrder: 0 }]
      : (r.tasks.length ? r.tasks : [{ t: null as unknown as TaskRow, minutes: r.activeMin }]).map((x, i) => {
          const src = x.t?.source ?? 'OTHER';
          const text = WORK_TEXT[src] ?? WORK_TEXT.OTHER;
          const title = x.t?.title ?? 'Team coordination and email follow-ups';
          const open = x.t && x.t.status !== 'DONE';
          return {
            taskId: x.t?.id ?? null, projectName: x.t?.projectName ?? null, taskTitle: title, workCompleted: fill(pick(text.done), title), result: fill(pick(text.result), title),
            pendingWork: open ? 'Remaining items tracked in the task' : null, blocker: open && chance(0.15) ? 'Waiting on input from another team' : null,
            nextAction: open ? fill(pick(['Continue implementation tomorrow', 'Follow up with {t} stakeholders', 'Address review comments', 'Schedule next call']), title) : null,
            minutesSpent: x.minutes, sortOrder: i,
          };
        });
    await prisma.dailyWorkReport.create({
      data: {
        userId: r.userId, date: dbDate(r.date), status: r.status, summary: r.vague ? null : `Worked ${Math.floor(r.activeMin / 60)}h ${r.activeMin % 60}m across ${items.length} item(s).`,
        autoDraft: { generatedAt: at.toISOString(), tasks: r.tasks.map((x) => ({ taskId: x.t.id, taskTitle: x.t.title, projectName: x.t.projectName, minutes: x.minutes })), topApps: [], activeMinutes: r.activeMin, suggestedItems: [] },
        submittedAt: r.status === 'DRAFT' ? null : at, reviewerId: r.reviewerId, reviewedAt: r.reviewerId ? new Date(at.getTime() + 14 * 3_600_000) : null,
        reviewNote: r.status === 'CHANGES_REQUESTED' ? 'Please add the result/outcome for each item and link the PR or ticket.' : r.status === 'APPROVED' ? 'Thanks, looks good.' : null,
        createdAt: at,
        items: { create: items },
      },
    });
    reportCount++;
  }

  // ── Workforce alerts (via the real rule evaluators) ──
  const alerts: Prisma.AlertCreateManyInput[] = [];
  const addAlert = (u: DemoUser, date: string, f: RuleFinding | null, ageDays: number) => {
    if (!f) return;
    const createdAt = new Date(now.getTime() - ageDays * DAY - int(1, 6) * 3_600_000);
    const resolved = ageDays > 3 && chance(0.7);
    alerts.push({
      subjectUserId: u.id, category: 'WORKFORCE', severity: f.severity as AlertSeverity, status: resolved ? 'RESOLVED' : chance(0.2) ? 'ACKNOWLEDGED' : 'OPEN',
      title: f.title, message: f.message, ruleKey: f.ruleKey, dedupeKey: dedupeKey(f.ruleKey, u.id, date), metadata: { ...f.metadata, date, seeded: true } as Prisma.InputJsonValue,
      createdAt, lastOccurredAt: createdAt, resolvedAt: resolved ? new Date(createdAt.getTime() + DAY) : null,
    });
  };
  const seen = new Set<string>();
  for (const f of sessionFacts) {
    const today = localDate(now, f.user.policy.timezone);
    const age = Math.round((dbDate(today).getTime() - dbDate(f.date).getTime()) / DAY);
    if (age > 6) continue;
    const s = { ...f, clockInAt: null };
    for (const finding of [evalLateLogin(f.user.displayName, f.user.policy, s), evalExcessiveIdle(f.user.displayName, f.user.policy, s), evalExcessiveOvertime(f.user.displayName, f.user.policy, s)]) {
      if (finding && !seen.has(`${finding.ruleKey}:${f.user.id}:${f.date}`)) {
        seen.add(`${finding.ruleKey}:${f.user.id}:${f.date}`);
        addAlert(f.user, f.date, finding, age);
      }
    }
    if (age >= 1 && age <= 3 && !f.reportSubmitted) addAlert(f.user, f.date, evalReportMissing(f.user.displayName, f.user.policy, f.date, true, false), age);
  }
  for (const b of blockedUses.filter((x, i, arr) => arr.findIndex((y) => y.user.id === x.user.id && y.date === x.date) === i)) {
    addAlert(b.user, b.date, { ruleKey: 'blocked_app_used', severity: 'HIGH', title: `Blocked app/site used: ${b.user.displayName}`, message: `${b.user.displayName} used blocked apps/sites: ${b.label}.`, metadata: { labels: [b.label] } }, 1);
  }
  for (const u of users) {
    const mine = tasks.filter((t) => t.assigneeId === u.id);
    const today = localDate(now, u.policy.timezone);
    addAlert(u, today, evalDeadlineAtRisk(u.displayName, u.policy, mine, now, today), 0);
    addAlert(u, today, evalRepeatedTaskDelay(u.displayName, mine), 0);
    addAlert(u, today, evalWorkloadOverload(u.displayName, u.policy, mine, today), 0);
  }
  if (alerts.length) await prisma.alert.createMany({ data: alerts });

  // ── AI insights (READY examples so the console has content without an API key) ──
  const yesterday = addDays(localDate(now, defaultPolicy.timezone), -1);
  const salesUser = users.find((u) => u.deptCode === 'SALES' && u.profile === 'normal');
  const facts = (u: DemoUser | undefined) => sessionFacts.find((f) => f.user.id === u?.id && f.date === yesterday);
  const ins: Prisma.AiInsightCreateManyInput[] = [];
  const e1 = employeeUser;
  const f1 = facts(e1);
  if (e1) {
    const worked = f1 ? Math.round((f1.activeSec + f1.meetingSec) / 60) : 0;
    ins.push({
      type: 'EMPLOYEE_DAILY', date: dbDate(yesterday), userId: e1.id, status: 'READY', model: 'claude-opus-5', customId: `emp:${e1.id}:${yesterday}`,
      inputTokens: 6412, outputTokens: 912, cacheReadTokens: 1480, completedAt: new Date(now.getTime() - 10 * 3_600_000),
      content: {
        summary: `James worked ${Math.floor(worked / 60)}h ${worked % 60}m, most of it in VS Code and GitHub on the Customer Portal v3 backlog, with ${f1 ? Math.round(f1.meetingSec / 60) : 0} minutes in meetings. Productive time was ${f1 ? pct(f1.productiveSec, f1.activeSec + f1.meetingSec) : 0}% of active time, close to the 14-day median.`,
        accomplishments: ['Progressed the cursor pagination work for the devices API', 'Reviewed pull requests for the agent enrollment wizard'],
        blockers: [{ description: 'Release notes for v3.2 depend on final API freeze', evidence: 'Task "Release notes + migration guide for v3.2" is IN_PROGRESS with 900 estimated minutes and is due tomorrow' }],
        reportConsistency: { status: 'CONSISTENT', notes: ['Report items match tracked time on the linked tasks (VS Code/GitHub activity during the same hours).'] },
        nonValueWork: [{ pattern: 'Repeated context switches between Jira and Slack for status updates', minutes: 35, suggestion: 'Batch status updates at two fixed times per day' }],
        workload: 'OVERLOADED',
        workloadReason: 'Two urgent tasks due tomorrow need ~27h of remaining estimate against ~8h of available time.',
        processImprovements: ['Split the v3.2 release notes task and assign the migration guide separately'],
        riskFlags: ['Deadline at risk: 2 tasks due tomorrow exceed remaining capacity', 'Both tasks were already delayed twice'],
        managerNote: 'Rebalance or re-scope the two v3.2 tasks due tomorrow.',
      },
    });
  }
  if (salesUser) {
    const f2 = facts(salesUser);
    const w = f2 ? Math.round((f2.activeSec + f2.meetingSec) / 60) : 0;
    ins.push({
      type: 'EMPLOYEE_DAILY', date: dbDate(yesterday), userId: salesUser.id, status: 'READY', model: 'claude-opus-5', customId: `emp:${salesUser.id}:${yesterday}`,
      inputTokens: 5987, outputTokens: 804, cacheReadTokens: 1480, completedAt: new Date(now.getTime() - 10 * 3_600_000),
      content: {
        summary: `${salesUser.displayName.split(' ')[0]} tracked ${Math.floor(w / 60)}h ${w % 60}m, mainly in Salesforce, Outlook and WhatsApp Web (classified productive for Sales), plus ${f2 ? Math.round(f2.meetingSec / 60) : 0} minutes of Zoom calls.`,
        accomplishments: ['Advanced two enterprise opportunities in the Q4 pipeline', 'Sent a proposal and pricing sheet'],
        blockers: [],
        reportConsistency: { status: 'PARTIAL', notes: ['Report lists two customer calls; tracked Zoom time covers one call. The second may have been by phone (no computer input).'] },
        nonValueWork: [{ pattern: 'Manual copy of lead details from spreadsheet into Salesforce', minutes: 40, suggestion: 'Use the CRM import template for lead batches' }],
        workload: 'BALANCED',
        workloadReason: 'Open task estimates due this week fit within available time.',
        processImprovements: ['Automate lead import from webinar tool into Salesforce'],
        riskFlags: [],
        managerNote: 'Pipeline work on track; consider automating lead imports.',
      },
    });
  }
  ins.push({
    type: 'MANAGEMENT_DAILY', date: dbDate(yesterday), departmentId: null, status: 'READY', model: 'claude-opus-5', customId: `mgmt:org:${yesterday}`,
    inputTokens: 9120, outputTokens: 1310, cacheReadTokens: 0, completedAt: new Date(now.getTime() - 9.5 * 3_600_000),
    content: {
      headline: 'Solid delivery day; Engineering has two v3.2 tasks at risk and Support is close to capacity',
      overview: `${sessionFacts.filter((f) => f.date === yesterday).length} employees worked yesterday. Average productive share was stable versus the 14-day baseline; most daily reports were submitted on time and matched tracked activity.`,
      highlights: ['Sales advanced several Q4 opportunities (Salesforce + Zoom time up)', 'Support closed most tickets within SLA', 'Finance progressed the Q3 close reconciliation'],
      concerns: ['Two Engineering tasks due tomorrow exceed remaining capacity', 'A few daily reports were vague or missing'],
      overloaded: e1 ? [{ name: e1.displayName, reason: '~27h of remaining estimate due tomorrow' }] : [],
      underUtilized: [],
      blockers: e1 ? [{ name: e1.displayName, blocker: 'v3.2 release notes depend on the API freeze' }] : [],
      reportGaps: ['Some reports only said "working on tasks" and were left as drafts'],
      processImprovements: ['Automate CRM lead imports', 'Batch status updates to reduce context switching'],
      recommendedActions: ['Re-scope or reassign one of the v3.2 tasks today', 'Remind teams of the daily report expectations (concrete outcome per item)'],
    },
  });
  await prisma.aiInsight.createMany({ data: ins, skipDuplicates: true });
  await prisma.systemSetting.upsert({
    where: { key: 'ai.lastRun' },
    create: { key: 'ai.lastRun', value: { date: yesterday, batchId: 'msgbatch_demo_seed', status: 'ended', employees: 2, succeeded: 2, failed: 0, inputTokens: 12399, outputTokens: 1716, cacheReadTokens: 2960, startedAt: new Date(now.getTime() - 11 * 3_600_000).toISOString(), endedAt: new Date(now.getTime() - 10 * 3_600_000).toISOString() } },
    update: {},
  });

  await prisma.systemSetting.upsert({ where: { key: DEMO_USERS_SETTING }, create: { key: DEMO_USERS_SETTING, value: users.map((u) => u.id) }, update: { value: users.map((u) => u.id) } });
  await prisma.systemSetting.upsert({ where: { key: DEMO_MARKER }, create: { key: DEMO_MARKER, value: WORKFORCE_DEMO_VERSION }, update: { value: WORKFORCE_DEMO_VERSION } });
  return {
    users: users.length, hr: hr.email, projects: projects.size, tasks: tasks.length, sessions: sessions.length, hourly: hourlyRows.length,
    segments: segmentsOut.length, clockEvents: clockEvents.length, timeEntries: timeEntries.length, reports: reportCount, alerts: alerts.length, insights: ins.length,
  };
}

export async function workforceDemoPresent(prisma: PrismaClient): Promise<boolean> {
  return !!(await prisma.systemSetting.findUnique({ where: { key: DEMO_MARKER } }));
}
