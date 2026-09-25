import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlertCategory, AlertSeverity, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QUEUE_ALERTS } from '../queues/queues';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { isScoped, scopedDepartmentIds, viaDevice } from '../common/scope';
import type { AuthUser } from '../common/types';
import { AlertQueryDto } from './alerts.dto';

export interface RaiseAlertInput {
  deviceId?: string | null;
  /** Employee the alert is about (workforce alerts). */
  subjectUserId?: string | null;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  ruleKey?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}

export const SEVERITY_ORDER: AlertSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const ALERT_INCLUDE = {
  device: { select: { id: true, deviceName: true, hostname: true, platform: true } },
  subjectUser: { select: { id: true, displayName: true, email: true, departmentId: true } },
} satisfies Prisma.AlertInclude;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_ALERTS) private readonly queue: Queue,
  ) {}

  /**
   * Raise an alert. With a dedupeKey, an existing OPEN/ACKNOWLEDGED alert is
   * updated (occurrences++) instead of creating a new one; only new alerts notify.
   */
  async raise(input: RaiseAlertInput): Promise<{ alert: { id: string }; created: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      if (input.dedupeKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.dedupeKey}))`;
        const existing = await tx.alert.findFirst({
          where: { dedupeKey: input.dedupeKey, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          const escalate = SEVERITY_ORDER.indexOf(input.severity) > SEVERITY_ORDER.indexOf(existing.severity);
          const updated = await tx.alert.update({
            where: { id: existing.id },
            data: {
              occurrences: { increment: 1 },
              lastOccurredAt: new Date(),
              message: input.message,
              ...(escalate ? { severity: input.severity } : {}),
            },
          });
          return { alert: updated, created: false, escalated: escalate };
        }
      }
      const alert = await tx.alert.create({
        data: {
          deviceId: input.deviceId ?? null,
          subjectUserId: input.subjectUserId ?? null,
          category: input.category,
          severity: input.severity,
          title: input.title.substring(0, 300),
          message: input.message.substring(0, 4000),
          ruleKey: input.ruleKey ?? null,
          dedupeKey: input.dedupeKey ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      return { alert, created: true, escalated: false };
    });
    if (result.created || result.escalated) {
      await this.queue
        .add('dispatch', { alertId: result.alert.id }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
        .catch((e) => this.logger.warn(`failed to queue alert dispatch: ${e.message}`));
    }
    return { alert: result.alert, created: result.created };
  }

  /** Auto-resolve open alerts for a dedupe key (e.g. compliance rule now passing). */
  async autoResolve(dedupeKey: string, reason: string): Promise<number> {
    const open = await this.prisma.alert.findMany({
      where: { dedupeKey, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: { id: true, deviceId: true },
    });
    if (!open.length) return 0;
    await this.prisma.alert.updateMany({
      where: { id: { in: open.map((a) => a.id) } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: null },
    });
    for (const a of open) {
      await this.audit.log({
        category: 'SECURITY',
        action: 'alert.auto_resolve',
        actorType: 'SYSTEM',
        actorId: null,
        actorName: 'system',
        resourceType: 'Alert',
        resourceId: a.id,
        deviceId: a.deviceId,
        metadata: { dedupeKey, reason },
      });
    }
    return open.length;
  }

  private scopeWhere(user?: AuthUser): Prisma.AlertWhereInput {
    if (!isScoped(user)) return {};
    // Managers also see workforce alerts about employees of their department(s).
    if (user!.roleKey === 'DEPARTMENT_MANAGER') {
      return { OR: [viaDevice(user), { subjectUser: { departmentId: { in: scopedDepartmentIds(user!) } } }] };
    }
    return { OR: [viaDevice(user), { subjectUserId: user!.id }] };
  }

  async list(q: AlertQueryDto, user?: AuthUser) {
    const and: Prisma.AlertWhereInput[] = [this.scopeWhere(user)];
    if (q.status) and.push({ status: q.status });
    if (q.severity) and.push({ severity: q.severity });
    if (q.category) and.push({ category: q.category });
    if (q.deviceId) and.push({ deviceId: q.deviceId });
    if (q.subjectUserId) and.push({ subjectUserId: q.subjectUserId });
    if (q.search) {
      and.push({
        OR: [
          { title: { contains: q.search, mode: 'insensitive' } },
          { message: { contains: q.search, mode: 'insensitive' } },
          { device: { deviceName: { contains: q.search, mode: 'insensitive' } } },
          { subjectUser: { displayName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        include: ALERT_INCLUDE,
        orderBy: orderBy(q, ['createdAt', 'lastOccurredAt', 'severity', 'status', 'occurrences'], 'createdAt'),
        ...skipTake(q),
      }),
      this.prisma.alert.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async recent(limit: number, user?: AuthUser) {
    return this.prisma.alert.findMany({
      where: this.scopeWhere(user),
      include: ALERT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async get(id: string, user?: AuthUser) {
    const alert = await this.prisma.alert.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: {
        ...ALERT_INCLUDE,
        deliveries: { include: { channel: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }

  async acknowledge(id: string, user: AuthUser) {
    const a = await this.get(id, user);
    if (a.status !== 'OPEN') return a;
    await this.prisma.alert.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedById: user.id, acknowledgedAt: new Date() },
    });
    await this.audit.log({ category: 'SECURITY', action: 'alert.acknowledge', resourceType: 'Alert', resourceId: id, deviceId: a.deviceId, before: { status: a.status }, after: { status: 'ACKNOWLEDGED' } });
    return this.get(id, user);
  }

  async resolve(id: string, user: AuthUser) {
    const a = await this.get(id, user);
    if (a.status === 'RESOLVED') return a;
    await this.prisma.alert.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedById: user.id,
        resolvedAt: new Date(),
        ...(a.acknowledgedAt ? {} : { acknowledgedById: user.id, acknowledgedAt: new Date() }),
      },
    });
    await this.audit.log({ category: 'SECURITY', action: 'alert.resolve', resourceType: 'Alert', resourceId: id, deviceId: a.deviceId, before: { status: a.status }, after: { status: 'RESOLVED' } });
    return this.get(id, user);
  }

  async bulk(ids: string[], action: 'acknowledge' | 'resolve', user: AuthUser) {
    const where: Prisma.AlertWhereInput = { AND: [{ id: { in: ids } }, this.scopeWhere(user)] };
    const now = new Date();
    const res =
      action === 'acknowledge'
        ? await this.prisma.alert.updateMany({
            where: { AND: [where, { status: 'OPEN' }] },
            data: { status: 'ACKNOWLEDGED', acknowledgedById: user.id, acknowledgedAt: now },
          })
        : await this.prisma.alert.updateMany({
            where: { AND: [where, { status: { not: 'RESOLVED' } }] },
            data: { status: 'RESOLVED', resolvedById: user.id, resolvedAt: now },
          });
    await this.audit.log({
      category: 'SECURITY',
      action: `alert.bulk_${action}`,
      resourceType: 'Alert',
      after: { action, updated: res.count },
      metadata: { ids: ids.slice(0, 500) },
    });
    return { updated: res.count };
  }
}
