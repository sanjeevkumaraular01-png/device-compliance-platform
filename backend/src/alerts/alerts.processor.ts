import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { AppConfigService } from '../config/app-config.service';
import { QUEUE_ALERTS } from '../queues/queues';
import { ChannelsService } from './channels.service';
import { NotifierService } from './notifier.service';
import { SEVERITY_ORDER } from './alerts.service';

const DELIVERY_ATTEMPTS = 5;

/** Fans an alert out to matching channels and delivers each with retries/backoff. */
@Processor(QUEUE_ALERTS, { concurrency: 5 })
export class AlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly notifier: NotifierService,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUE_ALERTS) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'dispatch') return this.dispatch(job.data.alertId as string);
    if (job.name === 'deliver') return this.deliver(job);
    return null;
  }

  private async dispatch(alertId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert || alert.status === 'RESOLVED') return { skipped: true };
    const channels = await this.prisma.alertChannel.findMany({ where: { enabled: true } });
    const sevIdx = SEVERITY_ORDER.indexOf(alert.severity);
    const matching = channels.filter(
      (c) => SEVERITY_ORDER.indexOf(c.minSeverity) <= sevIdx && (c.categories.length === 0 || c.categories.includes(alert.category)),
    );
    for (const ch of matching) {
      const delivery = await this.prisma.alertDelivery.create({ data: { alertId, channelId: ch.id } });
      await this.queue.add(
        'deliver',
        { deliveryId: delivery.id },
        { attempts: DELIVERY_ATTEMPTS, backoff: { type: 'exponential', delay: 10_000 } },
      );
    }
    return { channels: matching.length };
  }

  private async deliver(job: Job) {
    const delivery = await this.prisma.alertDelivery.findUnique({
      where: { id: job.data.deliveryId as string },
      include: { alert: { include: { device: { select: { deviceName: true } } } }, channel: true },
    });
    if (!delivery || delivery.status === 'SENT') return { skipped: true };
    const { alert, channel } = delivery;
    try {
      await this.notifier.send(channel.type, this.channels.decryptConfig(channel), {
        alertId: alert.id,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        category: alert.category,
        deviceName: alert.device?.deviceName ?? null,
        url: `${this.config.webUrl}/alerts/${alert.id}`,
        occurredAt: alert.lastOccurredAt.toISOString(),
      });
      await this.prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
      this.metrics.alertsSent.inc({ channel: channel.type, status: 'sent' });
      return { sent: true };
    } catch (e) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: final ? 'FAILED' : 'PENDING',
          attempts: { increment: 1 },
          error: (e as Error).message.substring(0, 1000),
        },
      });
      if (final) {
        this.metrics.alertsSent.inc({ channel: channel.type, status: 'failed' });
        this.logger.warn(`Alert delivery ${delivery.id} via ${channel.type} failed permanently: ${(e as Error).message}`);
      }
      throw e;
    }
  }
}
