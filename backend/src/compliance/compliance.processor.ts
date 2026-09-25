import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_COMPLIANCE } from '../queues/queues';
import { ComplianceService } from './compliance.service';

@Processor(QUEUE_COMPLIANCE, { concurrency: 4 })
export class ComplianceProcessor extends WorkerHost {
  private readonly logger = new Logger(ComplianceProcessor.name);

  constructor(private readonly compliance: ComplianceService) {
    super();
  }

  async process(job: Job<{ deviceId: string }>) {
    try {
      const r = await this.compliance.evaluateDevice(job.data.deviceId);
      return { state: r.state, score: r.score };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return { skipped: 'device not found' };
      this.logger.warn(`evaluation failed for ${job.data.deviceId}: ${(e as Error).message}`);
      throw e;
    }
  }
}
