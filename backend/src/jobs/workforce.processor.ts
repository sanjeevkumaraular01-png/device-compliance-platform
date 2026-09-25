import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_WORKFORCE } from '../queues/queues';
import { WorkforceJobsService } from '../workforce/workforce-jobs.service';
import { AttendanceService } from '../workforce/attendance.service';
import { ScreenshotsService } from '../workforce/screenshots.service';
import { AiService, RetryableAiError } from '../ai/ai.service';

type Schedule = { key: string; pattern?: string; every?: number };

/** Repeating workforce jobs (worker role only; registered by JobsScheduler). */
export const WORKFORCE_SCHEDULES: Schedule[] = [
  { key: 'workforce-live-rules', every: 10 * 60_000 },
  // report-missing at due time + nightly close (per policy time zone) + daily rules
  { key: 'workforce-daily', every: 10 * 60_000 },
  { key: 'workforce-hrms-push', every: 10 * 60_000 },
  { key: 'screenshots-purge', pattern: '45 3 * * *' },
  // AI nightly run at AI_DAILY_RUN_TIME (org time zone) + batch polling
  { key: 'ai-tick', every: 5 * 60_000 },
];

@Processor(QUEUE_WORKFORCE, { concurrency: 2 })
export class WorkforceProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkforceProcessor.name);

  constructor(
    private readonly jobs: WorkforceJobsService,
    private readonly attendance: AttendanceService,
    private readonly screenshots: ScreenshotsService,
    private readonly ai: AiService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'workforce-live-rules':
        return this.jobs.runLiveRules();
      case 'workforce-daily':
        return this.jobs.runDaily();
      case 'workforce-hrms-push':
        return this.attendance.pushIfDue();
      case 'screenshots-purge':
        return { purged: await this.screenshots.purgeExpired() };
      case 'ai-tick':
        try {
          return await this.ai.tick();
        } catch (e) {
          if (e instanceof RetryableAiError) {
            this.logger.warn(`AI tick deferred (retryable): ${e.message}`);
            return { deferred: e.message };
          }
          throw e;
        }
      case 'ai-management': {
        const { date, departmentId } = job.data as { date: string; departmentId: string | null };
        try {
          const r = await this.ai.generateManagement(date, departmentId ?? null);
          return { id: r.id, status: r.status };
        } catch (e) {
          if (e instanceof RetryableAiError) throw e; // 429 / 5xx / connection -> BullMQ exponential backoff
          // Permanent failure (400, AI disabled): already stored as FAILED where applicable; do not retry.
          return { failed: (e as Error).message };
        }
      }
      default:
        return null;
    }
  }
}
