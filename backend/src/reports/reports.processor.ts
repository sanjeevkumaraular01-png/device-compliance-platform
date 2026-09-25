import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_REPORTS } from '../queues/queues';
import { ReportsService } from './reports.service';

@Processor(QUEUE_REPORTS, { concurrency: 2 })
export class ReportsProcessor extends WorkerHost {
  constructor(private readonly reports: ReportsService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'generate') {
      const r = await this.reports.generate(job.data.reportId as string);
      return { status: r.status, rows: r.rowCount };
    }
    if (job.name === 'scheduled') return this.reports.runSchedule(job.data.scheduleId as string);
    return null;
  }
}
