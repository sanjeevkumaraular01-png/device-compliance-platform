import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AppConfigService } from '../config/app-config.service';
import type { AgentDevice, AuthUser } from '../common/types';
import { WorkforcePoliciesService } from './policies.service';
import { WorkforceIngestService } from './ingest.service';
import { WorkSessionsService } from './sessions.service';
import { assertCanView } from './workforce-scope';
import { isJpeg, jpegSize } from './core/jpeg';
import { isMeetingLabel } from './core/classifier';
import { dayRange, localDate } from './core/time';
import { AgentScreenshotDto, ScreenshotQueryDto } from './workforce.dto';

export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

/** Subset of a multer memory-storage file. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
  mimetype?: string;
  originalname?: string;
}

@Injectable()
export class ScreenshotsService {
  private readonly logger = new Logger(ScreenshotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
    private readonly policies: WorkforcePoliciesService,
    private readonly ingest: WorkforceIngestService,
    private readonly sessions: WorkSessionsService,
  ) {}

  private get dir() {
    return path.resolve(this.config.screenshotsDir);
  }

  /** `POST /agent/screenshots` — policy-checked, encrypted at rest. */
  async upload(agent: AgentDevice, dto: AgentScreenshotDto, file: UploadedImage | undefined) {
    if (!file?.buffer?.length) throw new UnprocessableEntityException('image (JPEG) is required');
    if (file.size > MAX_SCREENSHOT_BYTES) throw new UnprocessableEntityException('image exceeds 2 MB');
    if (!isJpeg(file.buffer)) throw new UnprocessableEntityException('image must be a JPEG');
    const capturedAt = new Date(dto.capturedAt);
    const now = new Date();
    if (Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > now.getTime() + 5 * 60_000) throw new UnprocessableEntityException('capturedAt is invalid');

    const user = await this.ingest.resolveUser(agent, dto.osUser);
    if (!user) throw new ConflictException('Device user is not mapped to a console user; screenshot rejected');
    const policy = await this.policies.forDepartment(user.departmentId);
    if (!policy.trackingEnabled || !policy.screenshotsEnabled) throw new ConflictException('Screenshots are disabled by the workforce policy');
    const blurred = dto.blurred === 'true';
    if (policy.screenshotBlur && !blurred) throw new ConflictException('Policy requires screenshots to be blurred on the device');
    const today = await this.sessions.todayEvents(user.id, policy, capturedAt);
    if (today.state.clockedOut) throw new ConflictException('User is clocked out; screenshot rejected');
    const seg = await this.prisma.activitySegment.findFirst({
      where: { userId: user.id, startedAt: { lte: new Date(capturedAt.getTime() + 60_000) }, endedAt: { gte: new Date(capturedAt.getTime() - 120_000) } },
      orderBy: { endedAt: 'desc' },
      select: { active: true, appLabel: true, taskId: true },
    });
    if (seg && !seg.active && !isMeetingLabel(seg.appLabel)) throw new ConflictException('User is idle; screenshot rejected');

    const size = jpegSize(file.buffer);
    const dateStr = localDate(capturedAt, policy.timezone);
    const running = await this.prisma.timeEntry.findFirst({ where: { userId: user.id, endedAt: null }, select: { taskId: true } });
    const row = await this.prisma.screenshot.create({
      data: {
        userId: user.id,
        deviceId: agent.id,
        capturedAt,
        filePath: '',
        sizeBytes: file.size,
        width: size?.width ?? Math.round(dto.width ?? 0),
        height: size?.height ?? Math.round(dto.height ?? 0),
        blurred,
        activeApp: dto.activeApp?.substring(0, 255) ?? seg?.appLabel ?? null,
        taskId: running?.taskId ?? seg?.taskId ?? null,
        expiresAt: new Date(capturedAt.getTime() + policy.screenshotRetentionDays * 86_400_000),
      },
    });
    const rel = path.join(user.id, dateStr, `${row.id}.enc`);
    const abs = path.join(this.dir, rel);
    try {
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, this.crypto.encryptBuffer(file.buffer), { mode: 0o600 });
    } catch (e) {
      await this.prisma.screenshot.delete({ where: { id: row.id } }).catch(() => undefined);
      throw e;
    }
    await this.prisma.screenshot.update({ where: { id: row.id }, data: { filePath: rel } });
    return { id: row.id, capturedAt: row.capturedAt, expiresAt: row.expiresAt };
  }

  private async targetUser(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, departmentId: true } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  private async assertAccess(user: AuthUser, targetId: string) {
    const target = await this.targetUser(targetId);
    const policy = await this.policies.forDepartment(target.departmentId);
    assertCanView(user, target, 'workforce:screenshots', { selfAllowed: policy.employeeCanSeeOwnData });
    return target;
  }

  async list(user: AuthUser, q: ScreenshotQueryDto) {
    await this.assertAccess(user, q.userId);
    const { policy } = await this.policies.forUser(q.userId);
    const date = q.date ?? localDate(new Date(), policy.timezone);
    const { start, end } = dayRange(date, policy.timezone);
    const rows = await this.prisma.screenshot.findMany({
      where: { userId: q.userId, capturedAt: { gte: start, lt: end } },
      orderBy: { capturedAt: 'asc' },
    });
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
    const tasks = taskIds.length ? await this.prisma.workTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } }) : [];
    const title = new Map(tasks.map((t) => [t.id, t.title]));
    return rows.map((r) => ({
      id: r.id,
      capturedAt: r.capturedAt,
      width: r.width,
      height: r.height,
      blurred: r.blurred,
      activeApp: r.activeApp,
      taskTitle: r.taskId ? (title.get(r.taskId) ?? null) : null,
    }));
  }

  /** Decrypt on the fly; every view is audited. */
  async image(user: AuthUser, id: string): Promise<Buffer> {
    const row = await this.prisma.screenshot.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Screenshot not found');
    await this.assertAccess(user, row.userId);
    let data: Buffer;
    try {
      data = this.crypto.decryptBuffer(await fs.promises.readFile(path.join(this.dir, row.filePath)));
    } catch (e) {
      this.logger.warn(`screenshot ${id} unreadable: ${(e as Error).message}`);
      throw new NotFoundException('Screenshot file is not available');
    }
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'workforce.screenshot.view',
      resourceType: 'Screenshot',
      resourceId: id,
      deviceId: row.deviceId,
      metadata: { subjectUserId: row.userId, capturedAt: row.capturedAt },
    });
    return data;
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.prisma.screenshot.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Screenshot not found');
    if (user.roleKey !== 'SUPER_ADMIN' && row.userId !== user.id) throw new ForbiddenException('Only a Super Admin or the employee can delete a screenshot');
    await this.deleteFile(row.filePath);
    await this.prisma.screenshot.delete({ where: { id } });
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'workforce.screenshot.delete',
      resourceType: 'Screenshot',
      resourceId: id,
      deviceId: row.deviceId,
      before: { userId: row.userId, capturedAt: row.capturedAt },
    });
  }

  private async deleteFile(rel: string) {
    if (!rel) return;
    await fs.promises.rm(path.join(this.dir, rel), { force: true }).catch(() => undefined);
  }

  /** Retention purge (worker, daily). */
  async purgeExpired(now = new Date()): Promise<number> {
    let purged = 0;
    for (;;) {
      const rows = await this.prisma.screenshot.findMany({ where: { expiresAt: { lt: now } }, take: 500, select: { id: true, filePath: true } });
      if (!rows.length) break;
      for (const r of rows) await this.deleteFile(r.filePath);
      await this.prisma.screenshot.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      purged += rows.length;
    }
    if (purged) {
      await this.audit.log({ category: 'SYSTEM', action: 'workforce.screenshot.purge', actorType: 'SYSTEM', actorId: null, actorName: 'scheduler', after: { purged } });
    }
    return purged;
  }

  async countForDay(userId: string, start: Date, end: Date) {
    return this.prisma.screenshot.count({ where: { userId, capturedAt: { gte: start, lt: end } } });
  }
}
