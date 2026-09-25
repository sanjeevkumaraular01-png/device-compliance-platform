import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { QUEUE_ALERTS, QUEUE_COMPLIANCE, QUEUE_MAINTENANCE, QUEUE_REPORTS } from '../queues/queues';
import { AlertSeverity, ComplianceState, OsPlatform, RiskLevel } from '@prisma/client';

const REFRESH_MS = 60_000;

/** Refreshes gauge metrics from the database / Redis every 60 seconds. */
@Injectable()
export class MetricsCollector implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollector.name);
  private timer?: NodeJS.Timeout;
  private readonly queues: Queue[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    @InjectQueue(QUEUE_ALERTS) alerts: Queue,
    @InjectQueue(QUEUE_REPORTS) reports: Queue,
    @InjectQueue(QUEUE_COMPLIANCE) compliance: Queue,
    @InjectQueue(QUEUE_MAINTENANCE) maintenance: Queue,
  ) {
    this.queues = [alerts, reports, compliance, maintenance];
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.refresh(), 2_000).unref();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const active = { status: { not: 'RETIRED' as const } };
      const [byPlatform, byState, byRisk, online, violations, alerts] = await Promise.all([
        this.prisma.device.groupBy({ by: ['platform'], where: active, _count: { _all: true } }),
        this.prisma.device.groupBy({ by: ['complianceState'], where: active, _count: { _all: true } }),
        this.prisma.device.groupBy({ by: ['riskLevel'], where: active, _count: { _all: true } }),
        this.prisma.device.count({ where: { ...active, lastSeenAt: { gte: new Date(Date.now() - 15 * 60_000) } } }),
        this.prisma.softwareInventory.count({
          where: { removedAt: null, status: { in: ['UNAUTHORIZED', 'BLACKLISTED'] }, device: active },
        }),
        this.prisma.alert.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
      ]);
      for (const p of Object.values(OsPlatform)) {
        this.metrics.devicesTotal.set({ platform: p }, byPlatform.find((x) => x.platform === p)?._count._all ?? 0);
      }
      for (const s of Object.values(ComplianceState)) {
        this.metrics.devicesCompliance.set({ state: s }, byState.find((x) => x.complianceState === s)?._count._all ?? 0);
      }
      for (const r of Object.values(RiskLevel)) {
        this.metrics.devicesRisk.set({ risk_level: r }, byRisk.find((x) => x.riskLevel === r)?._count._all ?? 0);
      }
      this.metrics.devicesOnline.set(online);
      this.metrics.softwareViolations.set(violations);
      for (const s of Object.values(AlertSeverity)) {
        this.metrics.alertsOpen.set({ severity: s }, alerts.find((x) => x.severity === s)?._count._all ?? 0);
      }
      for (const q of this.queues) {
        const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
        for (const [state, n] of Object.entries(counts)) this.metrics.queueJobs.set({ queue: q.name, state }, n);
      }
    } catch (e) {
      this.logger.warn(`metrics refresh failed: ${(e as Error).message}`);
    }
  }
}
