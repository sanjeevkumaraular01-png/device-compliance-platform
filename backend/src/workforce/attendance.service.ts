import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AttendanceStatus, Prisma, WorkLocation } from '@prisma/client';
import { createHmac } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService, randomToken } from '../common/crypto.service';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { toCsv } from '../common/utils/csv';
import type { AuthUser } from '../common/types';
import { WorkforcePoliciesService } from './policies.service';
import { WorkSessionsService } from './sessions.service';
import { assertCanView, assertDepartmentInScope, workforceUserWhere } from './workforce-scope';
import { isWorkDay } from './core/metrics';
import { addDays, datesBetween, dbDate, fromDbDate, localDate } from './core/time';
import { AttendanceCorrectionDto, AttendanceExportQueryDto, AttendanceQueryDto, HrmsSettingsDto, LeaveDto, MonthlyQueryDto } from './workforce.dto';

export const HRMS_SETTING_KEY = 'workforce.hrms';

interface HrmsStored {
  enabled: boolean;
  webhookUrl: string | null;
  authHeaderEnc: string | null;
  signingSecretEnc: string | null;
  sendDailyAt: string;
  lastSentDate: string | null;
  lastStatus: string | null;
}

const STATUS_CODE: Record<AttendanceStatus, string> = {
  PRESENT: 'P', LATE: 'L', HALF_DAY: 'HD', ABSENT: 'A', ON_LEAVE: 'LV', HOLIDAY: 'H', WEEKEND: 'WO',
};

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly policies: WorkforcePoliciesService,
    private readonly sessions: WorkSessionsService,
  ) {}

  // ───────────────────────── Daily list ─────────────────────────

  async list(user: AuthUser, q: AttendanceQueryDto) {
    assertDepartmentInScope(user, q.departmentId);
    const userWhere: Prisma.UserWhereInput = { AND: [workforceUserWhere(user), ...(q.departmentId ? [{ departmentId: q.departmentId }] : [])] };
    const where: Prisma.WorkSessionWhereInput = { user: userWhere };
    if (q.userId) where.userId = q.userId;
    if (q.status) where.status = q.status;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lte: dbDate(q.to) } : {}) };
    if (q.search) where.user = { AND: [userWhere, { OR: [{ displayName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }] };
    const [rows, total] = await Promise.all([
      this.prisma.workSession.findMany({
        where,
        include: { user: { select: { id: true, displayName: true, email: true, jobTitle: true, department: { select: { id: true, name: true } } } } },
        orderBy: q.sortBy ? orderBy(q, ['date', 'clockInAt', 'activeSec', 'lateMinutes', 'overtimeMinutes', 'status'], 'date') : [{ date: 'desc' }, { clockInAt: 'asc' }],
        ...skipTake(q),
      }),
      this.prisma.workSession.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  // ───────────────────────── Monthly sheet ─────────────────────────

  async monthly(user: AuthUser, q: MonthlyQueryDto) {
    assertDepartmentInScope(user, q.departmentId);
    const [y, m] = q.month.split('-').map(Number);
    const first = `${q.month}-01`;
    const last = new Date(Date.UTC(y, m, 0)).toISOString().substring(0, 10);
    const days = datesBetween(first, last);
    const users = await this.policies.trackedUsers({ AND: [workforceUserWhere(user), ...(q.departmentId ? [{ departmentId: q.departmentId }] : [])] });
    const ids = users.map((u) => u.id);
    const sessions = ids.length
      ? await this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: { gte: dbDate(first), lte: dbDate(last) } } })
      : [];
    const byKey = new Map(sessions.map((s) => [`${s.userId}:${fromDbDate(s.date)}`, s]));
    const orgToday = await this.policies.orgToday();

    const rows = users.map((u) => {
      const today = localDate(new Date(), u.policy.timezone) || orgToday;
      const totals = { present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, workedHours: 0, overtimeHours: 0, missingHours: 0 };
      const cells = days.map((d) => {
        const s = byKey.get(`${u.id}:${d}`);
        let status: AttendanceStatus | null = s?.status ?? null;
        if (!s && d < today) status = isWorkDay(u.policy, d) ? 'ABSENT' : 'WEEKEND';
        if (!s && d >= today && !isWorkDay(u.policy, d)) status = 'WEEKEND';
        const workedMinutes = s ? Math.floor((s.activeSec + s.meetingSec) / 60) : 0;
        if (status === 'PRESENT') totals.present++;
        if (status === 'LATE') {
          totals.late++;
          totals.present++;
        }
        if (status === 'HALF_DAY') totals.halfDay++;
        if (status === 'ABSENT') totals.absent++;
        if (status === 'ON_LEAVE') totals.leave++;
        totals.workedHours += workedMinutes / 60;
        totals.overtimeHours += (s?.overtimeMinutes ?? 0) / 60;
        if (s && d < today) totals.missingHours += s.missingMinutes / 60;
        return { date: d, status, workedMinutes, lateMinutes: s?.lateMinutes ?? 0, location: (s?.location ?? null) as WorkLocation | null };
      });
      const r1 = (n: number) => Math.round(n * 10) / 10;
      return {
        user: { id: u.id, displayName: u.displayName, email: u.email, jobTitle: u.jobTitle, department: u.department },
        days: cells,
        totals: { ...totals, workedHours: r1(totals.workedHours), overtimeHours: r1(totals.overtimeHours), missingHours: r1(totals.missingHours) },
      };
    });
    return { month: q.month, days, rows };
  }

  async export(user: AuthUser, q: AttendanceExportQueryDto): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const sheet = await this.monthly(user, q);
    const header = ['Employee', 'Email', 'Department', ...sheet.days.map((d) => d.substring(8)), 'Present', 'Late', 'Half day', 'Absent', 'Leave', 'Worked h', 'Overtime h', 'Missing h'];
    const rows = sheet.rows.map((r) => [
      r.user.displayName,
      r.user.email,
      r.user.department?.name ?? '',
      ...r.days.map((c) => (c.status ? `${STATUS_CODE[c.status]}${c.workedMinutes ? ` ${Math.round((c.workedMinutes / 60) * 10) / 10}h` : ''}` : '')),
      r.totals.present, r.totals.late, r.totals.halfDay, r.totals.absent, r.totals.leave, r.totals.workedHours, r.totals.overtimeHours, r.totals.missingHours,
    ]);
    const base = `attendance-${q.month}`;
    await this.audit.log({ category: 'USER_ACTION', action: 'workforce.attendance.export', resourceType: 'WorkSession', after: { month: q.month, format: q.format, departmentId: q.departmentId ?? null, rows: rows.length } });
    if (q.format === 'csv') return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(toCsv(header, rows), 'utf8') };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SecureEndpoint Manager';
    const ws = wb.addWorksheet(`Attendance ${q.month}`, { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
    ws.addRow(header);
    for (const r of rows) ws.addRow(r);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    ws.columns.forEach((c, i) => (c.width = i < 3 ? 26 : i < 3 + sheet.days.length ? 8 : 11));
    const legend = wb.addWorksheet('Legend');
    legend.addRow(['Code', 'Status']);
    for (const [k, v] of Object.entries(STATUS_CODE)) legend.addRow([v, k]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: buf };
  }

  // ───────────────────────── Corrections / leave ─────────────────────────

  async correct(user: AuthUser, sessionId: string, dto: AttendanceCorrectionDto) {
    this.policies.assertAttendanceManager(user);
    const s = await this.prisma.workSession.findUnique({ where: { id: sessionId }, include: { user: { select: { id: true, departmentId: true } } } });
    if (!s) throw new NotFoundException('Attendance record not found');
    assertCanView(user, s.user, 'workforce:manage');
    if (s.userId === user.id && user.roleKey !== 'SUPER_ADMIN') throw new UnprocessableEntityException('You cannot correct your own attendance');
    const clockInAt = dto.clockInAt === undefined ? s.clockInAt : dto.clockInAt ? new Date(dto.clockInAt) : null;
    const clockOutAt = dto.clockOutAt === undefined ? s.clockOutAt : dto.clockOutAt ? new Date(dto.clockOutAt) : null;
    if (clockInAt && clockOutAt && clockOutAt <= clockInAt) throw new BadRequestException('clockOutAt must be after clockInAt');
    const dateStr = fromDbDate(s.date);
    await this.prisma.workSession.update({
      where: { id: s.id },
      data: {
        clockInAt,
        clockOutAt,
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.location ? { location: dto.location } : {}),
        isManuallyAdjusted: true,
        adjustmentNote: dto.note,
        adjustedById: user.id,
      },
    });
    const events: Prisma.ClockEventCreateManyInput[] = [];
    if (dto.clockInAt) events.push({ userId: s.userId, type: 'CLOCK_IN', source: 'MANUAL_CORRECTION', note: dto.note, occurredAt: new Date(dto.clockInAt), location: dto.location ?? s.location });
    if (dto.clockOutAt) events.push({ userId: s.userId, type: 'CLOCK_OUT', source: 'MANUAL_CORRECTION', note: dto.note, occurredAt: new Date(dto.clockOutAt), location: dto.location ?? s.location });
    if (events.length) await this.prisma.clockEvent.createMany({ data: events });
    const after = await this.sessions.recompute(s.userId, dateStr, { final: !!s.closedAt });
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'workforce.attendance.correct',
      resourceType: 'WorkSession',
      resourceId: s.id,
      before: { clockInAt: s.clockInAt, clockOutAt: s.clockOutAt, status: s.status, location: s.location },
      after: { clockInAt: after?.clockInAt, clockOutAt: after?.clockOutAt, status: after?.status, location: after?.location, note: dto.note },
      metadata: { subjectUserId: s.userId, date: dateStr },
    });
    return after;
  }

  async leave(user: AuthUser, dto: LeaveDto) {
    this.policies.assertAttendanceManager(user);
    if (dto.to < dto.from) throw new BadRequestException('to must be on or after from');
    const days = datesBetween(dto.from, dto.to, 93);
    if (days.length > 92 || addDays(dto.from, 92) < dto.to) throw new BadRequestException('Leave ranges are limited to 92 days');
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, departmentId: true } });
    if (!target) throw new NotFoundException('User not found');
    assertCanView(user, target, 'workforce:manage');
    const policy = await this.policies.forDepartment(target.departmentId);
    const leaveDays = days.filter((d) => isWorkDay(policy, d));
    const sessions = [];
    for (const d of leaveDays) {
      sessions.push(
        await this.prisma.workSession.upsert({
          where: { userId_date: { userId: dto.userId, date: dbDate(d) } },
          create: { userId: dto.userId, date: dbDate(d), status: 'ON_LEAVE', isManuallyAdjusted: true, adjustmentNote: `Leave: ${dto.reason}`, adjustedById: user.id },
          update: { status: 'ON_LEAVE', isManuallyAdjusted: true, adjustmentNote: `Leave: ${dto.reason}`, adjustedById: user.id, lateMinutes: 0, missingMinutes: 0, earlyLeaveMinutes: 0 },
        }),
      );
    }
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'workforce.leave.create',
      resourceType: 'User',
      resourceId: dto.userId,
      after: { from: dto.from, to: dto.to, reason: dto.reason, days: leaveDays },
    });
    return { userId: dto.userId, days: leaveDays, sessions };
  }

  // ───────────────────────── HRMS integration ─────────────────────────

  private async hrmsStored(): Promise<HrmsStored> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: HRMS_SETTING_KEY } });
    const v = (row?.value ?? {}) as Partial<HrmsStored>;
    return {
      enabled: !!v.enabled,
      webhookUrl: v.webhookUrl ?? null,
      authHeaderEnc: v.authHeaderEnc ?? null,
      signingSecretEnc: v.signingSecretEnc ?? null,
      sendDailyAt: v.sendDailyAt ?? '06:00',
      lastSentDate: v.lastSentDate ?? null,
      lastStatus: v.lastStatus ?? null,
    };
  }

  private async saveHrms(v: HrmsStored) {
    await this.prisma.systemSetting.upsert({
      where: { key: HRMS_SETTING_KEY },
      create: { key: HRMS_SETTING_KEY, value: v as unknown as Prisma.InputJsonValue },
      update: { value: v as unknown as Prisma.InputJsonValue },
    });
  }

  private hrmsPublic(v: HrmsStored) {
    return {
      enabled: v.enabled,
      webhookUrl: v.webhookUrl,
      authHeaderSet: !!v.authHeaderEnc,
      signingSecret: v.signingSecretEnc ? this.crypto.decrypt(v.signingSecretEnc) : null,
      sendDailyAt: v.sendDailyAt,
      lastSentDate: v.lastSentDate,
      lastStatus: v.lastStatus,
    };
  }

  async getHrms(user: AuthUser) {
    this.policies.assertAttendanceManager(user);
    return this.hrmsPublic(await this.hrmsStored());
  }

  async putHrms(user: AuthUser, dto: HrmsSettingsDto) {
    this.policies.assertAttendanceManager(user);
    const cur = await this.hrmsStored();
    const next: HrmsStored = {
      ...cur,
      enabled: dto.enabled,
      webhookUrl: dto.webhookUrl ?? cur.webhookUrl,
      sendDailyAt: dto.sendDailyAt ?? cur.sendDailyAt,
      authHeaderEnc: dto.authHeader === undefined ? cur.authHeaderEnc : dto.authHeader ? this.crypto.encrypt(dto.authHeader) : null,
      signingSecretEnc: cur.signingSecretEnc ?? this.crypto.encrypt(randomToken('whsec_', 32)),
    };
    if (next.enabled && !next.webhookUrl) throw new BadRequestException('webhookUrl is required when the HRMS integration is enabled');
    await this.saveHrms(next);
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'workforce.hrms.update',
      resourceType: 'SystemSetting',
      resourceId: HRMS_SETTING_KEY,
      before: { enabled: cur.enabled, webhookUrl: cur.webhookUrl, sendDailyAt: cur.sendDailyAt },
      after: { enabled: next.enabled, webhookUrl: next.webhookUrl, sendDailyAt: next.sendDailyAt, authHeaderChanged: dto.authHeader !== undefined },
    });
    return this.hrmsPublic(next);
  }

  /** Closed attendance records for `date` in the HRMS payload shape. */
  async hrmsPayload(date: string) {
    const sessions = await this.prisma.workSession.findMany({
      where: { date: dbDate(date) },
      include: { user: { select: { email: true, externalId: true } } },
      orderBy: { userId: 'asc' },
    });
    return {
      date,
      records: sessions.map((s) => ({
        employeeEmail: s.user.email,
        employeeExternalId: s.user.externalId,
        status: s.status,
        clockInAt: s.clockInAt,
        clockOutAt: s.clockOutAt,
        workedMinutes: Math.floor((s.activeSec + s.meetingSec) / 60),
        lateMinutes: s.lateMinutes,
        overtimeMinutes: s.overtimeMinutes,
        location: s.location,
      })),
    };
  }

  private async post(v: HrmsStored, payload: unknown): Promise<{ status: number; ok: boolean }> {
    if (!v.webhookUrl) throw new UnprocessableEntityException('HRMS webhookUrl is not configured');
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'SecureEndpoint-Manager/1.0' };
    if (v.authHeaderEnc) headers['Authorization'] = this.crypto.decrypt(v.authHeaderEnc);
    if (v.signingSecretEnc) headers['X-SEM-Signature'] = 'sha256=' + createHmac('sha256', this.crypto.decrypt(v.signingSecretEnc)).update(body).digest('hex');
    const res = await fetch(v.webhookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
    return { status: res.status, ok: res.ok };
  }

  async testHrms(user: AuthUser) {
    this.policies.assertAttendanceManager(user);
    const v = await this.hrmsStored();
    const payload = {
      date: localDate(new Date(), await this.policies.orgTimezone()),
      test: true,
      records: [{ employeeEmail: 'sample.employee@example.com', employeeExternalId: 'EMP-0001', status: 'PRESENT', clockInAt: new Date().toISOString(), clockOutAt: null, workedMinutes: 480, lateMinutes: 0, overtimeMinutes: 0, location: 'OFFICE' }],
    };
    let result: { status: number; ok: boolean };
    try {
      result = await this.post(v, payload);
    } catch (e) {
      if (e instanceof UnprocessableEntityException) throw e;
      result = { status: 0, ok: false };
      this.logger.warn(`HRMS test failed: ${(e as Error).message}`);
    }
    await this.audit.log({ category: 'USER_ACTION', action: 'workforce.hrms.test', resourceType: 'SystemSetting', resourceId: HRMS_SETTING_KEY, success: result.ok, after: result });
    return { delivered: result.ok, status: result.status };
  }

  /** Worker: push the previous day's closed attendance once `sendDailyAt` (org tz) has passed. */
  async pushIfDue(now = new Date()): Promise<{ pushed: boolean; date?: string; status?: number }> {
    const v = await this.hrmsStored();
    if (!v.enabled || !v.webhookUrl) return { pushed: false };
    const tz = await this.policies.orgTimezone();
    const today = localDate(now, tz);
    const yesterday = addDays(today, -1);
    if (v.lastSentDate && v.lastSentDate >= yesterday) return { pushed: false };
    const [hh, mm] = v.sendDailyAt.split(':').map(Number);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const [lh, lm] = local.split(':').map(Number);
    if (lh * 60 + lm < hh * 60 + mm) return { pushed: false };
    const payload = await this.hrmsPayload(yesterday);
    let status = 0;
    try {
      const res = await this.post(v, payload);
      status = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      await this.saveHrms({ ...v, lastStatus: `failed: ${(e as Error).message}`.substring(0, 200) });
      throw e; // BullMQ retries
    }
    await this.saveHrms({ ...v, lastSentDate: yesterday, lastStatus: `ok ${status}` });
    await this.audit.log({ category: 'SYSTEM', action: 'workforce.hrms.push', actorType: 'SYSTEM', actorId: null, actorName: 'scheduler', resourceType: 'SystemSetting', resourceId: HRMS_SETTING_KEY, after: { date: yesterday, records: payload.records.length, status } });
    return { pushed: true, date: yesterday, status };
  }
}
