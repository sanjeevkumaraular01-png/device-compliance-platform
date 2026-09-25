import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppRule, Prisma, WorkforcePolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AppConfigService } from '../config/app-config.service';
import { paginated, skipTake, orderBy } from '../common/dto/pagination.dto';
import { isValidCidr } from '../common/utils/cidr';
import type { AuthUser } from '../common/types';
import { classify, RuleLike } from './core/classifier';
import { isValidTimeZone, localDate, dayRange, addDays } from './core/time';
import {
  AppRuleQueryDto,
  AssignWorkforcePolicyDto,
  CreateAppRuleDto,
  CreateWorkforcePolicyDto,
  RangeQueryDto,
  UpdateAppRuleDto,
  UpdateWorkforcePolicyDto,
} from './workforce.dto';

const CACHE_MS = 30_000;

/** Subset of the policy exposed to employees (`/workforce/me`). */
export function publicPolicy(p: WorkforcePolicy) {
  return {
    id: p.id,
    name: p.name,
    trackingEnabled: p.trackingEnabled,
    timezone: p.timezone,
    workDays: p.workDays,
    workStart: p.workStart,
    workEnd: p.workEnd,
    graceMinutes: p.graceMinutes,
    minDailyMinutes: p.minDailyMinutes,
    halfDayMinutes: p.halfDayMinutes,
    overtimeAfterMinutes: p.overtimeAfterMinutes,
    maxBreakMinutes: p.maxBreakMinutes,
    trackOutsideWorkHours: p.trackOutsideWorkHours,
    idleThresholdSec: p.idleThresholdSec,
    trackApps: p.trackApps,
    trackWebsites: p.trackWebsites,
    captureWindowTitles: p.captureWindowTitles,
    screenshotsEnabled: p.screenshotsEnabled,
    screenshotIntervalMin: p.screenshotIntervalMin,
    screenshotBlur: p.screenshotBlur,
    screenshotRetentionDays: p.screenshotRetentionDays,
    requireTaskSelection: p.requireTaskSelection,
    requireDailyReport: p.requireDailyReport,
    dailyReportDueTime: p.dailyReportDueTime,
    employeeCanSeeOwnData: p.employeeCanSeeOwnData,
    showTrackingNotice: p.showTrackingNotice,
  };
}

/** Transparency notice shown by the agent and the console. */
export function trackingNoticeText(p: WorkforcePolicy, companyName: string): string {
  const what = [
    'active/idle time',
    p.trackApps ? 'applications used' : null,
    p.trackWebsites ? 'websites (domain only)' : null,
    p.captureWindowTitles ? 'window titles' : null,
    p.screenshotsEnabled ? `screenshots every ~${p.screenshotIntervalMin} min${p.screenshotBlur ? ' (blurred)' : ''}` : null,
  ].filter(Boolean);
  return `${companyName} records work activity on this device during work hours: ${what.join(', ')}. No keystrokes or typed content are ever recorded. You can see your own data in the console under "My Day".`;
}

export interface TrackedUser {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  externalId: string | null;
}

@Injectable()
export class WorkforcePoliciesService {
  private policyCache: { at: number; policies: WorkforcePolicy[]; deptPolicy: Map<string, string | null> } | null = null;
  private ruleCache: { at: number; rules: AppRule[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly config: AppConfigService,
  ) {}

  invalidate() {
    this.policyCache = null;
    this.ruleCache = null;
  }

  // ───────────────────────── Resolution ─────────────────────────

  private async loadPolicies() {
    if (this.policyCache && Date.now() - this.policyCache.at < CACHE_MS) return this.policyCache;
    const [policies, depts] = await Promise.all([
      this.prisma.workforcePolicy.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.department.findMany({ select: { id: true, workforcePolicyId: true } }),
    ]);
    this.policyCache = { at: Date.now(), policies, deptPolicy: new Map(depts.map((d) => [d.id, d.workforcePolicyId])) };
    return this.policyCache;
  }

  /** Built-in fallback when no policy row exists yet (fresh install before seed). */
  private fallbackPolicy(): WorkforcePolicy {
    const now = new Date(0);
    return {
      id: '00000000-0000-0000-0000-000000000000', name: 'Built-in defaults', description: null, isDefault: true, trackingEnabled: true,
      timezone: this.config.workforceTimezone, workDays: [1, 2, 3, 4, 5], workStart: '09:30', workEnd: '18:30', graceMinutes: 15,
      minDailyMinutes: 480, halfDayMinutes: 240, overtimeAfterMinutes: 540, maxBreakMinutes: 60, trackOutsideWorkHours: false,
      idleThresholdSec: 300, trackApps: true, trackWebsites: true, captureWindowTitles: false, screenshotsEnabled: false,
      screenshotIntervalMin: 15, screenshotBlur: true, screenshotRetentionDays: 30, officeNetworks: [], requireTaskSelection: false,
      requireDailyReport: true, dailyReportDueTime: '19:30', alertLateLogin: true, alertNoActivityMinutes: 30, alertIdlePercent: 40,
      alertOvertimeMinutes: 120, alertUnproductivePercent: 30, employeeCanSeeOwnData: true, showTrackingNotice: true, version: 1,
      createdAt: now, updatedAt: now,
    };
  }

  /** Policy for a department: department.workforcePolicy, else the default policy. */
  async forDepartment(departmentId: string | null | undefined): Promise<WorkforcePolicy> {
    const c = await this.loadPolicies();
    const pid = departmentId ? c.deptPolicy.get(departmentId) : null;
    return (
      (pid && c.policies.find((p) => p.id === pid)) || c.policies.find((p) => p.isDefault) || c.policies[0] || this.fallbackPolicy()
    );
  }

  async forUser(userId: string): Promise<{ user: TrackedUser; policy: WorkforcePolicy }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: TRACKED_USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return { user, policy: await this.forDepartment(user.departmentId) };
  }

  async orgTimezone(): Promise<string> {
    const tz = await this.settings.get<string>('workforceTimezone');
    return typeof tz === 'string' && isValidTimeZone(tz) ? tz : this.config.workforceTimezone;
  }

  async orgToday(): Promise<string> {
    return localDate(new Date(), await this.orgTimezone());
  }

  async rules(): Promise<AppRule[]> {
    if (this.ruleCache && Date.now() - this.ruleCache.at < CACHE_MS) return this.ruleCache.rules;
    const rules = await this.prisma.appRule.findMany();
    this.ruleCache = { at: Date.now(), rules };
    return rules;
  }

  /**
   * Employees whose workforce data is tracked: active users with a tracking-enabled
   * policy who have an assigned device or recent workforce activity (so service
   * accounts without endpoints do not show up as ABSENT every day).
   */
  async trackedUsers(where: Prisma.UserWhereInput = {}): Promise<(TrackedUser & { policy: WorkforcePolicy })[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          where,
          { isActive: true },
          {
            OR: [
              { assignedDevices: { some: { status: { not: 'RETIRED' } } } },
              { workSessions: { some: { date: { gte: since } } } },
            ],
          },
        ],
      },
      select: TRACKED_USER_SELECT,
      orderBy: { displayName: 'asc' },
    });
    const out: (TrackedUser & { policy: WorkforcePolicy })[] = [];
    for (const u of users) {
      const policy = await this.forDepartment(u.departmentId);
      if (policy.trackingEnabled) out.push({ ...u, policy });
    }
    return out;
  }

  // ───────────────────────── Policies CRUD ─────────────────────────

  listPolicies() {
    return this.prisma.workforcePolicy.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { departments: { select: { id: true, name: true } } },
    });
  }

  async getPolicy(id: string) {
    const p = await this.prisma.workforcePolicy.findUnique({ where: { id }, include: { departments: { select: { id: true, name: true } } } });
    if (!p) throw new NotFoundException('Workforce policy not found');
    return p;
  }

  private validatePolicy(dto: Partial<CreateWorkforcePolicyDto>) {
    const errors: string[] = [];
    if (dto.timezone !== undefined && !isValidTimeZone(dto.timezone)) errors.push('timezone must be a valid IANA time zone');
    if (dto.workStart && dto.workEnd && dto.workStart >= dto.workEnd) errors.push('workStart must be before workEnd');
    for (const n of dto.officeNetworks ?? []) {
      const v = n.trim();
      if (v.toLowerCase().startsWith('ssid:')) {
        if (!v.substring(5).trim()) errors.push(`officeNetworks: "${n}" needs an SSID name`);
      } else if (!isValidCidr(v)) errors.push(`officeNetworks: "${n}" is not a CIDR or ssid:<name>`);
    }
    if (dto.workDays) dto.workDays = [...new Set(dto.workDays)].sort();
    if (errors.length) throw new BadRequestException(errors);
  }

  async createPolicy(dto: CreateWorkforcePolicyDto) {
    this.validatePolicy(dto);
    const exists = await this.prisma.workforcePolicy.findUnique({ where: { name: dto.name } });
    if (exists) throw new ConflictException('A workforce policy with this name already exists');
    const p = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.workforcePolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.workforcePolicy.create({ data: { ...dto, officeNetworks: dto.officeNetworks?.map((s) => s.trim()) ?? [] } });
    });
    this.invalidate();
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'workforce.policy.create', resourceType: 'WorkforcePolicy', resourceId: p.id, after: p });
    return this.getPolicy(p.id);
  }

  async updatePolicy(id: string, dto: UpdateWorkforcePolicyDto) {
    const before = await this.getPolicy(id);
    const merged = { workStart: before.workStart, workEnd: before.workEnd, ...dto };
    this.validatePolicy(merged);
    if (dto.workDays) dto.workDays = merged.workDays;
    if (dto.isDefault === false && before.isDefault) throw new BadRequestException('Mark another policy as default instead');
    const p = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.workforcePolicy.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.workforcePolicy.update({
        where: { id },
        data: { ...dto, ...(dto.officeNetworks ? { officeNetworks: dto.officeNetworks.map((s) => s.trim()) } : {}), version: { increment: 1 } },
      });
    });
    this.invalidate();
    const { departments: _d, ...b } = before;
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'workforce.policy.update',
      resourceType: 'WorkforcePolicy',
      resourceId: id,
      before: Object.fromEntries(Object.keys(dto).map((k) => [k, (b as Record<string, unknown>)[k]])),
      after: Object.fromEntries(Object.keys(dto).map((k) => [k, (p as Record<string, unknown>)[k]])),
    });
    return this.getPolicy(id);
  }

  async deletePolicy(id: string) {
    const p = await this.getPolicy(id);
    if (p.isDefault) throw new BadRequestException('The default workforce policy cannot be deleted');
    await this.prisma.workforcePolicy.delete({ where: { id } });
    this.invalidate();
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'workforce.policy.delete', resourceType: 'WorkforcePolicy', resourceId: id, before: p });
  }

  async assignPolicy(id: string, dto: AssignWorkforcePolicyDto) {
    await this.getPolicy(id);
    const res = await this.prisma.department.updateMany({ where: { id: { in: dto.departmentIds } }, data: { workforcePolicyId: id } });
    await this.prisma.workforcePolicy.update({ where: { id }, data: { version: { increment: 1 } } });
    this.invalidate();
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'workforce.policy.assign',
      resourceType: 'WorkforcePolicy',
      resourceId: id,
      after: { departmentIds: dto.departmentIds, updated: res.count },
    });
    return this.getPolicy(id);
  }

  // ───────────────────────── App rules ─────────────────────────

  async listRules(q: AppRuleQueryDto) {
    const where: Prisma.AppRuleWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.category) where.category = q.category;
    if (q.departmentId) where.departmentId = q.departmentId === 'global' ? null : q.departmentId;
    if (q.search) {
      where.OR = [
        { pattern: { contains: q.search, mode: 'insensitive' } },
        { label: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.appRule.findMany({
        where,
        include: { department: { select: { id: true, name: true } } },
        orderBy: q.sortBy ? orderBy(q, ['label', 'pattern', 'category', 'kind', 'createdAt'], 'label') : [{ category: 'asc' }, { label: 'asc' }],
        ...skipTake(q),
      }),
      this.prisma.appRule.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  private validateRule(r: { matchType?: string; pattern?: string; kind?: string }) {
    if (r.matchType === 'REGEX' && r.pattern) {
      try {
        new RegExp(r.pattern, 'i');
      } catch (e) {
        throw new BadRequestException(`pattern is not a valid regular expression: ${(e as Error).message}`);
      }
    }
  }

  async createRule(dto: CreateAppRuleDto) {
    this.validateRule(dto);
    const pattern = dto.kind === 'WEBSITE' && dto.matchType !== 'REGEX' ? dto.pattern.trim().toLowerCase() : dto.pattern.trim();
    const dup = await this.prisma.appRule.findFirst({ where: { kind: dto.kind, pattern, departmentId: dto.departmentId ?? null } });
    if (dup) throw new ConflictException('A rule with this kind, pattern and department already exists');
    const rule = await this.prisma.appRule.create({
      data: { kind: dto.kind, pattern, matchType: dto.matchType ?? 'CONTAINS', label: dto.label.trim(), category: dto.category, departmentId: dto.departmentId ?? null },
    });
    this.ruleCache = null;
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'workforce.app_rule.create', resourceType: 'AppRule', resourceId: rule.id, after: rule });
    return rule;
  }

  async updateRule(id: string, dto: UpdateAppRuleDto) {
    const before = await this.prisma.appRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('App rule not found');
    this.validateRule({ matchType: dto.matchType ?? before.matchType, pattern: dto.pattern ?? before.pattern });
    const rule = await this.prisma.appRule.update({
      where: { id },
      data: { ...dto, ...(dto.pattern ? { pattern: dto.pattern.trim() } : {}), ...(dto.label ? { label: dto.label.trim() } : {}) },
    });
    this.ruleCache = null;
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'workforce.app_rule.update', resourceType: 'AppRule', resourceId: id, before, after: rule });
    return rule;
  }

  async deleteRule(id: string) {
    const before = await this.prisma.appRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('App rule not found');
    await this.prisma.appRule.delete({ where: { id } });
    this.ruleCache = null;
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'workforce.app_rule.delete', resourceType: 'AppRule', resourceId: id, before });
  }

  /** Most-used unmatched apps/domains so admins can classify them quickly. */
  async uncategorized(q: RangeQueryDto) {
    const tz = await this.orgTimezone();
    const to = q.to ?? localDate(new Date(), tz);
    const from = q.from ?? addDays(to, -6);
    const start = dayRange(from, tz).start;
    const end = dayRange(to, tz).end;
    const rows = await this.prisma.$queryRaw<{ kind: string; value: string; seconds: bigint; users: bigint }[]>`
      SELECT CASE WHEN domain IS NOT NULL THEN 'WEBSITE' ELSE 'APP' END AS kind,
             COALESCE(domain, app) AS value,
             SUM(duration_sec)::bigint AS seconds,
             COUNT(DISTINCT user_id)::bigint AS users
      FROM activity_segments
      WHERE category = 'UNCATEGORIZED' AND started_at >= ${start} AND started_at < ${end}
        AND COALESCE(domain, app) IS NOT NULL
      GROUP BY 1, 2
      ORDER BY seconds DESC
      LIMIT 300`;
    // Hide values that a rule added since then now classifies.
    const rules = (await this.rules()).filter((r) => r.departmentId === null) as RuleLike[];
    return rows
      .filter((r) => classify(r.kind === 'WEBSITE' ? { domain: r.value } : { app: r.value }, rules, null).category === 'UNCATEGORIZED')
      .slice(0, 100)
      .map((r) => ({ kind: r.kind as 'APP' | 'WEBSITE', value: r.value, seconds: Number(r.seconds), users: Number(r.users) }));
  }

  /** IT_ADMIN's workforce:manage covers policies + app rules only. */
  assertAttendanceManager(user: AuthUser) {
    if (user.roleKey === 'IT_ADMIN') throw new ForbiddenException('IT Admins can manage workforce policies and app categories only');
  }

  async companyName(): Promise<string> {
    const n = await this.settings.get<string>('companyName');
    return typeof n === 'string' && n ? n : 'Your organization';
  }
}

export const TRACKED_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  jobTitle: true,
  departmentId: true,
  externalId: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;
