import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DailyReportStatus, Prisma, WorkforcePolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginated } from '../common/dto/pagination.dto';
import { scopedDepartmentIds } from '../common/scope';
import type { AuthUser } from '../common/types';
import { WorkforcePoliciesService } from '../workforce/policies.service';
import { WorkforceLiveService } from '../workforce/live.service';
import { assertDepartmentInScope, workforceUserWhere } from '../workforce/workforce-scope';
import { isWorkDay } from '../workforce/core/metrics';
import { addDays, DATE_RE, datesBetween, dayRange, dbDate, fromDbDate, localDate, zonedTime } from '../workforce/core/time';
import { DailyReportItemInput, validateReportForSubmit } from './validation';
import { DailyReportQueryDto, ReviewDailyReportDto, SaveDailyReportDto, SubmitDailyReportDto } from './daily-reports.dto';

export interface AutoDraft {
  generatedAt: string;
  tasks: { taskId: string; taskTitle: string; projectName: string | null; minutes: number }[];
  topApps: { label: string; minutes: number }[];
  activeMinutes: number;
  suggestedItems: DailyReportItemInput[];
}

const REPORT_INCLUDE = {
  items: { orderBy: { sortOrder: 'asc' } },
  user: { select: { id: true, displayName: true, email: true, jobTitle: true, department: { select: { id: true, name: true } } } },
  reviewer: { select: { id: true, displayName: true } },
} satisfies Prisma.DailyWorkReportInclude;

@Injectable()
export class DailyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policies: WorkforcePoliciesService,
    private readonly live: WorkforceLiveService,
  ) {}

  private checkDate(date: string, policy: WorkforcePolicy) {
    if (!DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const today = localDate(new Date(), policy.timezone);
    if (date > today) throw new BadRequestException('Reports cannot be written for future dates');
    if (date < addDays(today, -31)) throw new BadRequestException('Reports older than 31 days cannot be edited');
  }

  /** Draft generated from the day's tracked tasks + apps. Employees still write the actual text. */
  async buildAutoDraft(userId: string, date: string, tz: string): Promise<AutoDraft> {
    const { start, end } = dayRange(date, tz);
    const now = new Date();
    const [entries, apps, session] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { userId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
        include: { task: { select: { id: true, title: true, project: { select: { name: true } } } } },
      }),
      this.live.appUsage({ userIds: [userId], start, end, limit: 8 }),
      this.prisma.workSession.findUnique({ where: { userId_date: { userId, date: dbDate(date) } } }),
    ]);
    const tasks = new Map<string, AutoDraft['tasks'][number]>();
    for (const e of entries) {
      const s = Math.max(e.startedAt.getTime(), start.getTime());
      const en = Math.min((e.endedAt ?? now).getTime(), end.getTime());
      const t = tasks.get(e.taskId) ?? { taskId: e.taskId, taskTitle: e.task.title, projectName: e.task.project?.name ?? null, minutes: 0 };
      t.minutes += Math.max(0, Math.round((en - s) / 60_000));
      tasks.set(e.taskId, t);
    }
    const list = [...tasks.values()].sort((a, b) => b.minutes - a.minutes);
    return {
      generatedAt: now.toISOString(),
      tasks: list,
      topApps: apps.map((a) => ({ label: a.label, minutes: Math.round(a.seconds / 60) })),
      activeMinutes: session ? Math.floor((session.activeSec + session.meetingSec) / 60) : 0,
      suggestedItems: list.map((t) => ({
        taskId: t.taskId,
        projectName: t.projectName,
        taskTitle: t.taskTitle,
        workCompleted: '',
        result: '',
        pendingWork: null,
        blocker: null,
        nextAction: null,
        evidenceUrl: null,
        minutesSpent: t.minutes,
      })),
    };
  }

  async getMine(user: AuthUser, date: string) {
    const { policy } = await this.policies.forUser(user.id);
    if (!DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const report = await this.prisma.dailyWorkReport.findUnique({ where: { userId_date: { userId: user.id, date: dbDate(date) } }, include: REPORT_INCLUDE });
    if (report) return { ...report, saved: true };
    const autoDraft = await this.buildAutoDraft(user.id, date, policy.timezone);
    return {
      id: null,
      userId: user.id,
      date: dbDate(date),
      status: 'DRAFT' as DailyReportStatus,
      summary: null,
      autoDraft,
      submittedAt: null,
      reviewerId: null,
      reviewNote: null,
      reviewedAt: null,
      items: autoDraft.suggestedItems.map((it, i) => ({ id: null, reportId: null, sortOrder: i, ...it })),
      saved: false,
    };
  }

  private async save(user: AuthUser, date: string, summary: string | null | undefined, items: DailyReportItemInput[] | undefined, policy: WorkforcePolicy) {
    const existing = await this.prisma.dailyWorkReport.findUnique({ where: { userId_date: { userId: user.id, date: dbDate(date) } } });
    if (existing && (existing.status === 'SUBMITTED' || existing.status === 'APPROVED')) {
      throw new ConflictException(`Report is already ${existing.status.toLowerCase()} and can no longer be edited`);
    }
    if (items) {
      const taskIds = [...new Set(items.map((i) => i.taskId).filter((x): x is string => !!x))];
      if (taskIds.length) {
        const found = await this.prisma.workTask.count({ where: { id: { in: taskIds } } });
        if (found !== taskIds.length) throw new BadRequestException('One or more taskId values do not exist');
      }
    }
    const autoDraft = existing?.autoDraft && Object.keys(existing.autoDraft as object).length ? existing.autoDraft : await this.buildAutoDraft(user.id, date, policy.timezone);
    return this.prisma.$transaction(async (tx) => {
      const report = existing
        ? await tx.dailyWorkReport.update({ where: { id: existing.id }, data: { ...(summary !== undefined ? { summary } : {}) } })
        : await tx.dailyWorkReport.create({ data: { userId: user.id, date: dbDate(date), summary: summary ?? null, autoDraft: autoDraft as Prisma.InputJsonValue } });
      if (items) {
        await tx.dailyReportItem.deleteMany({ where: { reportId: report.id } });
        if (items.length) {
          await tx.dailyReportItem.createMany({
            data: items.map((it, i) => ({
              reportId: report.id,
              taskId: it.taskId ?? null,
              projectName: it.projectName ?? null,
              taskTitle: it.taskTitle.trim(),
              workCompleted: it.workCompleted.trim(),
              result: it.result.trim(),
              pendingWork: it.pendingWork ?? null,
              blocker: it.blocker ?? null,
              nextAction: it.nextAction ?? null,
              evidenceUrl: it.evidenceUrl ?? null,
              minutesSpent: it.minutesSpent ?? null,
              sortOrder: i,
            })),
          });
        }
      }
      return report;
    });
  }

  async saveMine(user: AuthUser, date: string, dto: SaveDailyReportDto) {
    const { policy } = await this.policies.forUser(user.id);
    this.checkDate(date, policy);
    const r = await this.save(user, date, dto.summary, dto.items, policy);
    return this.prisma.dailyWorkReport.findUniqueOrThrow({ where: { id: r.id }, include: REPORT_INCLUDE });
  }

  async submitMine(user: AuthUser, date: string, dto: SubmitDailyReportDto = {}) {
    const { policy } = await this.policies.forUser(user.id);
    this.checkDate(date, policy);
    const r = await this.save(user, date, dto.summary, dto.items, policy);
    const report = await this.prisma.dailyWorkReport.findUniqueOrThrow({ where: { id: r.id }, include: REPORT_INCLUDE });
    const taskIds = report.items.map((i) => i.taskId).filter((x): x is string => !!x);
    const tasks = taskIds.length ? await this.prisma.workTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true } }) : [];
    const errors = validateReportForSubmit(report.items, { taskStatus: Object.fromEntries(tasks.map((t) => [t.id, t.status])) });
    if (errors.length) throw new UnprocessableEntityException(errors);
    const submitted = await this.prisma.dailyWorkReport.update({
      where: { id: report.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: REPORT_INCLUDE,
    });
    // A submitted report resolves the "missing" alert for that day.
    await this.prisma.alert.updateMany({
      where: { dedupeKey: `workforce:daily_report_missing:${user.id}:${date}`, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return submitted;
  }

  // ───────────────────────── Team list / review ─────────────────────────

  async list(user: AuthUser, q: DailyReportQueryDto) {
    assertDepartmentInScope(user, q.departmentId);
    const orgToday = await this.policies.orgToday();
    const to = q.date ?? q.to ?? orgToday;
    const from = q.date ?? q.from ?? to;
    if (from > to) throw new BadRequestException('from must be on or before to');
    if (datesBetween(from, to, 100).length > 62) throw new BadRequestException('Date range is limited to 62 days');
    const userAnd: Prisma.UserWhereInput[] = [workforceUserWhere(user)];
    if (q.departmentId) userAnd.push({ departmentId: q.departmentId });
    if (q.userId) userAnd.push({ id: q.userId });
    if (q.search) userAnd.push({ OR: [{ displayName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] });
    const users = await this.policies.trackedUsers({ AND: userAnd });
    const ids = users.map((u) => u.id);
    const [reports, sessions] = await Promise.all([
      ids.length
        ? this.prisma.dailyWorkReport.findMany({
            where: { userId: { in: ids }, date: { gte: dbDate(from), lte: dbDate(to) }, ...(q.status && q.status !== 'MISSING' ? { status: q.status } : {}) },
            include: REPORT_INCLUDE,
            orderBy: [{ date: 'desc' }, { submittedAt: 'desc' }],
          })
        : [],
      ids.length ? this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: { gte: dbDate(from), lte: dbDate(to) } }, select: { userId: true, date: true, status: true } }) : [],
    ]);
    type Row = (typeof reports)[number] | {
      id: null; userId: string; date: Date; status: 'MISSING'; missing: true; items: never[];
      user: { id: string; displayName: string; email: string; jobTitle: string | null; department: { id: string; name: string } | null };
    };
    const rows: Row[] = q.status === 'MISSING' ? [] : [...reports];
    if (!q.status || q.status === 'MISSING') {
      const have = new Set(reports.map((r) => `${r.userId}:${fromDbDate(r.date)}`));
      const allReports = q.status ? new Set(
        (ids.length ? await this.prisma.dailyWorkReport.findMany({ where: { userId: { in: ids }, date: { gte: dbDate(from), lte: dbDate(to) } }, select: { userId: true, date: true } }) : []).map((r) => `${r.userId}:${fromDbDate(r.date)}`),
      ) : have;
      const sessBy = new Map(sessions.map((s) => [`${s.userId}:${fromDbDate(s.date)}`, s.status]));
      const now = new Date();
      for (const u of users) {
        if (!u.policy.requireDailyReport) continue;
        for (const d of datesBetween(from, to)) {
          if (!isWorkDay(u.policy, d) || allReports.has(`${u.id}:${d}`)) continue;
          const st = sessBy.get(`${u.id}:${d}`);
          // Only days the employee actually worked can miss a report.
          if (!st || !['PRESENT', 'LATE', 'HALF_DAY'].includes(st)) continue;
          const today = localDate(now, u.policy.timezone);
          if (d > today) continue;
          if (d === today && now < zonedTime(d, u.policy.dailyReportDueTime, u.policy.timezone)) continue;
          rows.push({ id: null, userId: u.id, date: dbDate(d), status: 'MISSING', missing: true, items: [], user: { id: u.id, displayName: u.displayName, email: u.email, jobTitle: u.jobTitle, department: u.department } });
        }
      }
    }
    rows.sort((a, b) => b.date.getTime() - a.date.getTime() || a.user.displayName.localeCompare(b.user.displayName));
    const start = (q.page - 1) * q.pageSize;
    return paginated(rows.slice(start, start + q.pageSize), q.page, q.pageSize, rows.length);
  }

  async get(user: AuthUser, id: string) {
    const r = await this.prisma.dailyWorkReport.findFirst({ where: { id, user: workforceUserWhere(user) }, include: REPORT_INCLUDE });
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }

  async review(user: AuthUser, id: string, dto: ReviewDailyReportDto) {
    const r = await this.prisma.dailyWorkReport.findUnique({ where: { id }, include: { user: { select: { id: true, departmentId: true } } } });
    if (!r) throw new NotFoundException('Report not found');
    if (user.roleKey === 'DEPARTMENT_MANAGER' && (!r.user.departmentId || !scopedDepartmentIds(user).includes(r.user.departmentId))) {
      throw new ForbiddenException('Report is outside your department scope');
    }
    if (r.userId === user.id) throw new ForbiddenException('You cannot review your own report');
    if (r.status !== 'SUBMITTED' && r.status !== 'APPROVED' && r.status !== 'CHANGES_REQUESTED') throw new ConflictException('Only submitted reports can be reviewed');
    const updated = await this.prisma.dailyWorkReport.update({
      where: { id },
      data: { status: dto.status, reviewerId: user.id, reviewNote: dto.note ?? null, reviewedAt: new Date() },
      include: REPORT_INCLUDE,
    });
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'workforce.report.review',
      resourceType: 'DailyWorkReport',
      resourceId: id,
      before: { status: r.status },
      after: { status: dto.status, note: dto.note ?? null },
      metadata: { subjectUserId: r.userId, date: fromDbDate(r.date) },
    });
    return updated;
  }
}
