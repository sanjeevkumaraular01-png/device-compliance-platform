import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, Report, ReportFormat, ReportType } from '@prisma/client';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { parseExpression } from 'cron-parser';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { NotifierService } from '../alerts/notifier.service';
import { QUEUE_REPORTS } from '../queues/queues';
import { RUN_WORKER } from '../config/role';
import { orderBy, paginated, PaginationQueryDto, skipTake } from '../common/dto/pagination.dto';
import { isScoped } from '../common/scope';
import type { AuthUser } from '../common/types';
import { ReportDataService, ReportParameters } from './report-data.service';
import { renderCsv, renderPdf, renderXlsx } from './renderers/renderers';
import { CreateReportDto, CreateScheduleDto, ReportQueryDto } from './reports.dto';

const EXT: Record<ReportFormat, string> = { PDF: 'pdf', XLSX: 'xlsx', CSV: 'csv' };
export const CONTENT_TYPES: Record<ReportFormat, string> = {
  PDF: 'application/pdf',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv; charset=utf-8',
};

const REPORT_INCLUDE = { requestedBy: { select: { id: true, displayName: true, email: true } } } satisfies Prisma.ReportInclude;

@Injectable()
export class ReportsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly data: ReportDataService,
    private readonly notifier: NotifierService,
    @InjectQueue(QUEUE_REPORTS) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    fs.mkdirSync(path.resolve(this.config.reportsDir), { recursive: true });
    if (RUN_WORKER && process.env.NODE_ENV !== 'test') {
      await this.syncSchedulers().catch((e) => this.logger.warn(`report scheduler sync failed: ${e.message}`));
    }
  }

  private dir() {
    return path.resolve(this.config.reportsDir);
  }

  // ── Ad-hoc reports ──
  async list(q: ReportQueryDto, user: AuthUser) {
    const where: Prisma.ReportWhereInput = {
      ...(isScoped(user) ? { requestedById: user.id } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.format ? { format: q.format } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: orderBy(q, ['createdAt', 'completedAt', 'name', 'type', 'status'], 'createdAt'),
        ...skipTake(q),
      }),
      this.prisma.report.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async get(id: string, user: AuthUser) {
    const r = await this.prisma.report.findUnique({ where: { id }, include: REPORT_INCLUDE });
    if (!r || (isScoped(user) && r.requestedById !== user.id)) throw new NotFoundException('Report not found');
    return r;
  }

  async create(dto: CreateReportDto, user: AuthUser) {
    if (dto.type === 'AUDIT' && !user.permissions.includes('audit:read')) {
      throw new UnprocessableEntityException('Audit reports require the audit:read permission');
    }
    const params = this.cleanParams(dto.parameters ?? {});
    const report = await this.prisma.report.create({
      data: {
        name: dto.name || `${this.data.title(dto.type)} ${new Date().toISOString().substring(0, 10)}`,
        type: dto.type,
        format: dto.format,
        parameters: params as Prisma.InputJsonValue,
        requestedById: user.id,
      },
      include: REPORT_INCLUDE,
    });
    await this.queue.add('generate', { reportId: report.id }, { attempts: 2, backoff: { type: 'fixed', delay: 5000 } });
    await this.audit.log({ category: 'USER_ACTION', action: 'report.create', resourceType: 'Report', resourceId: report.id, after: { type: dto.type, format: dto.format, parameters: params } });
    return report;
  }

  private cleanParams(p: ReportParameters): ReportParameters {
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')) as ReportParameters;
  }

  async download(id: string, user: AuthUser) {
    const r = await this.get(id, user);
    if (r.status !== 'COMPLETED' || !r.filePath) throw new UnprocessableEntityException(`Report is ${r.status}`);
    const file = path.resolve(r.filePath);
    if (!file.startsWith(this.dir()) || !fs.existsSync(file)) throw new NotFoundException('Report file no longer exists');
    await this.audit.log({ category: 'USER_ACTION', action: 'report.download', resourceType: 'Report', resourceId: id });
    const safeName = r.name.replace(/[^A-Za-z0-9._ -]/g, '_').substring(0, 120);
    return { file, filename: `${safeName}.${EXT[r.format]}`, contentType: CONTENT_TYPES[r.format], size: r.fileSize ?? undefined };
  }

  async remove(id: string, user: AuthUser) {
    const r = await this.get(id, user);
    if (r.filePath) {
      const file = path.resolve(r.filePath);
      if (file.startsWith(this.dir())) fs.rmSync(file, { force: true });
    }
    await this.prisma.report.delete({ where: { id } });
    await this.audit.log({ category: 'USER_ACTION', action: 'report.delete', resourceType: 'Report', resourceId: id, before: { name: r.name, type: r.type } });
  }

  /** Worker: build dataset, render the file and mark the report COMPLETED/FAILED. */
  async generate(reportId: string): Promise<Report> {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    await this.prisma.report.update({ where: { id: reportId }, data: { status: 'RUNNING', startedAt: new Date(), error: null } });
    try {
      const requester = report.requestedById ? await this.loadRequester(report.requestedById) : undefined;
      const ds = await this.data.build(report.type, report.parameters as ReportParameters, requester);
      ds.title = report.name || ds.title;
      fs.mkdirSync(this.dir(), { recursive: true });
      const file = path.join(this.dir(), `${report.id}.${EXT[report.format]}`);
      if (report.format === 'PDF') await renderPdf(ds, file);
      else if (report.format === 'XLSX') await renderXlsx(ds, file);
      else await renderCsv(ds, file);
      const size = fs.statSync(file).size;
      return await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'COMPLETED', filePath: file, fileSize: size, rowCount: ds.rows.length, completedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`report ${reportId} failed: ${(e as Error).message}`, (e as Error).stack);
      return this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'FAILED', error: (e as Error).message.substring(0, 1000), completedAt: new Date() },
      });
    }
  }

  private async loadRequester(userId: string): Promise<AuthUser | undefined> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true, managedDepartments: { select: { id: true } } } });
    if (!u) return undefined;
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      roleKey: u.role.key,
      roleName: u.role.name,
      permissions: u.role.permissions,
      departmentId: u.departmentId,
      managedDepartmentIds: u.managedDepartments.map((d) => d.id),
      sessionId: '',
    };
  }

  // ── Schedules ──
  private validateCron(cron: string) {
    try {
      parseExpression(cron, { utc: true });
    } catch {
      throw new BadRequestException('cron is not a valid cron expression');
    }
    if (cron.trim().split(/\s+/).length > 5) throw new BadRequestException('cron must have 5 fields (minute precision)');
  }

  async listSchedules(q: PaginationQueryDto) {
    const [rows, total] = await Promise.all([
      this.prisma.reportSchedule.findMany({ orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.reportSchedule.count(),
    ]);
    return paginated(
      rows.map((s) => ({ ...s, nextRunAt: s.enabled ? this.nextRun(s.cron) : null })),
      q.page,
      q.pageSize,
      total,
    );
  }

  private nextRun(cron: string): string | null {
    try {
      return parseExpression(cron, { utc: true }).next().toDate().toISOString();
    } catch {
      return null;
    }
  }

  async createSchedule(dto: CreateScheduleDto, user: AuthUser) {
    this.validateCron(dto.cron);
    const s = await this.prisma.reportSchedule.create({
      data: {
        name: dto.name,
        type: dto.type,
        format: dto.format,
        cron: dto.cron.trim(),
        parameters: this.cleanParams(dto.parameters ?? {}) as Prisma.InputJsonValue,
        recipients: dto.recipients,
        enabled: dto.enabled ?? true,
        createdById: user.id,
      },
    });
    await this.upsertScheduler(s.id, s.cron, s.enabled);
    await this.audit.log({ category: 'USER_ACTION', action: 'report_schedule.create', resourceType: 'ReportSchedule', resourceId: s.id, after: s });
    return { ...s, nextRunAt: s.enabled ? this.nextRun(s.cron) : null };
  }

  async getSchedule(id: string) {
    const s = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Schedule not found');
    return { ...s, nextRunAt: s.enabled ? this.nextRun(s.cron) : null };
  }

  async deleteSchedule(id: string) {
    const s = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Schedule not found');
    await this.prisma.reportSchedule.delete({ where: { id } });
    await this.queue.removeJobScheduler(`report-schedule:${id}`).catch(() => undefined);
    await this.audit.log({ category: 'USER_ACTION', action: 'report_schedule.delete', resourceType: 'ReportSchedule', resourceId: id, before: s });
  }

  private async upsertScheduler(id: string, cron: string, enabled: boolean) {
    const key = `report-schedule:${id}`;
    if (!enabled) {
      await this.queue.removeJobScheduler(key).catch(() => undefined);
      return;
    }
    await this.queue.upsertJobScheduler(key, { pattern: cron, tz: 'UTC' }, { name: 'scheduled', data: { scheduleId: id } });
  }

  /** Ensure BullMQ job schedulers mirror the report_schedules table. */
  async syncSchedulers() {
    const schedules = await this.prisma.reportSchedule.findMany();
    const wanted = new Set(schedules.filter((s) => s.enabled).map((s) => `report-schedule:${s.id}`));
    for (const s of schedules) await this.upsertScheduler(s.id, s.cron, s.enabled);
    const existing = await this.queue.getJobSchedulers();
    for (const j of existing) {
      if (j.key.startsWith('report-schedule:') && !wanted.has(j.key)) await this.queue.removeJobScheduler(j.key);
    }
  }

  /** Worker: run a schedule, then email the file to recipients when SMTP is configured. */
  async runSchedule(scheduleId: string) {
    const s = await this.prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
    if (!s || !s.enabled) return { skipped: true };
    const report = await this.prisma.report.create({
      data: {
        name: `${s.name} ${new Date().toISOString().substring(0, 10)}`,
        type: s.type as ReportType,
        format: s.format,
        parameters: s.parameters as Prisma.InputJsonValue,
        requestedById: s.createdById,
      },
    });
    const done = await this.generate(report.id);
    await this.prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: new Date() } });
    let emailed = false;
    if (done.status === 'COMPLETED' && done.filePath && s.recipients.length && this.config.smtpConfigured) {
      try {
        await this.notifier.sendEmail(
          s.recipients,
          {
            title: `Scheduled report: ${s.name}`,
            message: `Your scheduled ${s.type.toLowerCase()} report (${done.rowCount ?? 0} rows) is attached.`,
            severity: 'INFO',
            category: 'SYSTEM',
            url: `${this.config.webUrl}/reports`,
          },
          [{ filename: `${s.name.replace(/[^A-Za-z0-9._ -]/g, '_')}.${EXT[s.format]}`, path: done.filePath }],
        );
        emailed = true;
      } catch (e) {
        this.logger.warn(`failed to email scheduled report ${s.id}: ${(e as Error).message}`);
      }
    }
    await this.audit.log({
      category: 'SYSTEM',
      action: 'report_schedule.run',
      actorType: 'SYSTEM',
      actorId: null,
      actorName: 'scheduler',
      resourceType: 'ReportSchedule',
      resourceId: s.id,
      success: done.status === 'COMPLETED',
      metadata: { reportId: report.id, emailed },
    });
    return { reportId: report.id, status: done.status, emailed };
  }

  /** Remove old report files (maintenance). */
  async purgeOld(days: number) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await this.prisma.report.findMany({ where: { createdAt: { lt: cutoff } } });
    for (const r of old) {
      if (r.filePath) fs.rmSync(path.resolve(r.filePath), { force: true });
    }
    await this.prisma.report.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    return old.length;
  }
}
