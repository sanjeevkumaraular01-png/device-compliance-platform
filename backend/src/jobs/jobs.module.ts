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
import { AppConfigService } from '../config/app-config.service';

/** Repeating maintenance jobs (BullMQ job schedulers, safe with multiple workers). */
type Schedule = { key: string; pattern?: string; every?: number };
const SCHEDULES: Schedule[] = [
  { key: 'mark-offline', every: 5 * 60_000 },
  { key: 'usb-expire', every: 5 * 60_000 },
  { key: 'commands-expire', every: 5 * 60_000 },
  { key: 'warranty-refresh', pattern: '15 1 * * *' },
  { key: 'nightly-compliance', pattern: '0 2 * * *' },
  { key: 'reports-purge', pattern: '30 3 * * *' },
];

/** Demo installs only: see MaintenanceProcessor.demoActivity. */
const DEMO_ACTIVITY: Schedule = { key: 'demo-activity', every: 5 * 60_000 };

@Injectable()
export class JobsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(
    @InjectQueue(QUEUE_MAINTENANCE) private readonly queue: Queue,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const schedules = this.config.demoActivity ? [...SCHEDULES, DEMO_ACTIVITY] : SCHEDULES;
    for (const s of schedules) {
      await this.queue.upsertJobScheduler(
        s.key,
        s.pattern ? { pattern: s.pattern, tz: 'UTC' } : { every: s.every! },
        { name: s.key, data: {}, opts: { removeOnComplete: 50, removeOnFail: 100 } },
      );
    }
    // Turning demo mode off must stop the simulated check-ins.
    if (!this.config.demoActivity) await this.queue.removeJobScheduler(DEMO_ACTIVITY.key);
    this.logger.log(`Registered ${schedules.length} maintenance schedules${this.config.demoActivity ? ' (demo activity on)' : ''}`);
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
      case DEMO_ACTIVITY.key:
        return this.demoActivity();
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

  /**
   * Demo installs have no real agents, so seeded devices would all drift "offline"
   * within minutes and, after a week, fail AGENT_OFFLINE. Refresh lastSeenAt for a
   * stable ~85% of ACTIVE seeded devices (the rest stay offline, as in a real fleet).
   * Only rows written by the seed (security_status.raw.collector = 'seed') are touched,
   * never devices enrolled by a real agent.
   */
  async demoActivity() {
    const touched = await this.prisma.$executeRaw`
      UPDATE devices d
      SET last_seen_at = now() - (random() * interval '4 minutes')
      FROM security_status s
      WHERE s.device_id = d.id
        AND s.raw ->> 'collector' = 'seed'
        AND d.status = 'ACTIVE'
        AND ('x' || substr(md5(d.id::text), 1, 8))::bit(32)::int % 100 < 85`;
    return { demoDevicesRefreshed: touched };
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
