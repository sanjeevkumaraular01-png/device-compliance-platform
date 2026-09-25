import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsbService } from '../usb/usb.service';
import { ComplianceService } from '../compliance/compliance.service';
import { SettingsService } from '../settings/settings.service';
import { ReportsService } from '../reports/reports.service';
import { QUEUE_MAINTENANCE } from '../queues/queues';

/** Repeating maintenance jobs (BullMQ job schedulers, safe with multiple workers). */
const SCHEDULES: { key: string; pattern?: string; every?: number }[] = [
  { key: 'mark-offline', every: 5 * 60_000 },
  { key: 'usb-expire', every: 5 * 60_000 },
  { key: 'commands-expire', every: 5 * 60_000 },
  { key: 'warranty-refresh', pattern: '15 1 * * *' },
  { key: 'nightly-compliance', pattern: '0 2 * * *' },
  { key: 'reports-purge', pattern: '30 3 * * *' },
];

@Injectable()
export class JobsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(@InjectQueue(QUEUE_MAINTENANCE) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    for (const s of SCHEDULES) {
      await this.queue.upsertJobScheduler(
        s.key,
        s.pattern ? { pattern: s.pattern, tz: 'UTC' } : { every: s.every! },
        { name: s.key, data: {}, opts: { removeOnComplete: 50, removeOnFail: 100 } },
      );
    }
    this.logger.log(`Registered ${SCHEDULES.length} maintenance schedules`);
  }
}

@Processor(QUEUE_MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usb: UsbService,
    private readonly compliance: ComplianceService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'mark-offline':
        return this.markOffline();
      case 'usb-expire':
        return { expired: await this.usb.expireRequests() };
      case 'commands-expire':
        return this.expireCommands();
      case 'warranty-refresh':
        return this.refreshWarranty();
      case 'nightly-compliance':
        return { queued: await this.compliance.queueAll() };
      case 'reports-purge': {
        const days = (await this.settings.get<number>('reportRetentionDays')) ?? 30;
        return { purged: await this.reports.purgeOld(days) };
      }
      default:
        return null;
    }
  }

  /** ACTIVE devices silent for longer than `deviceInactiveAfterHours` become INACTIVE. */
  async markOffline() {
    const hours = (await this.settings.get<number>('deviceInactiveAfterHours')) ?? 24;
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const stale = await this.prisma.device.findMany({
      where: { status: 'ACTIVE', lastSeenAt: { lt: cutoff } },
      select: { id: true, deviceName: true },
    });
    if (!stale.length) return { inactive: 0 };
    await this.prisma.device.updateMany({ where: { id: { in: stale.map((d) => d.id) } }, data: { status: 'INACTIVE' } });
    for (const d of stale) {
      await this.audit.log({
        category: 'DEVICE_CHANGE',
        action: 'device.offline',
        actorType: 'SYSTEM',
        actorId: null,
        actorName: 'scheduler',
        resourceType: 'Device',
        resourceId: d.id,
        deviceId: d.id,
        before: { status: 'ACTIVE' },
        after: { status: 'INACTIVE', thresholdHours: hours },
      });
    }
    return { inactive: stale.length };
  }

  async expireCommands() {
    const res = await this.prisma.deviceCommand.updateMany({
      where: { status: { in: ['PENDING', 'SENT'] }, expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', completedAt: new Date() },
    });
    if (res.count) {
      await this.audit.log({ category: 'SYSTEM', action: 'commands.expire', actorType: 'SYSTEM', actorId: null, actorName: 'scheduler', after: { expired: res.count } });
    }
    return { expired: res.count };
  }

  async refreshWarranty() {
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 86_400_000);
    const [expired, expiring, active] = await Promise.all([
      this.prisma.device.updateMany({ where: { warrantyExpiresAt: { lt: now }, warrantyStatus: { not: 'EXPIRED' } }, data: { warrantyStatus: 'EXPIRED' } }),
      this.prisma.device.updateMany({ where: { warrantyExpiresAt: { gte: now, lte: soon }, warrantyStatus: { not: 'EXPIRING' } }, data: { warrantyStatus: 'EXPIRING' } }),
      this.prisma.device.updateMany({ where: { warrantyExpiresAt: { gt: soon }, warrantyStatus: { not: 'ACTIVE' } }, data: { warrantyStatus: 'ACTIVE' } }),
    ]);
    return { expired: expired.count, expiring: expiring.count, active: active.count };
  }
}

@Module({
  providers: [JobsScheduler, MaintenanceProcessor],
})
export class JobsModule {}
