import { Module } from '@nestjs/common';
import { WorkforcePoliciesService } from './policies.service';
import { WorkSessionsService } from './sessions.service';
import { WorkforceIngestService } from './ingest.service';
import { WorkforceLiveService } from './live.service';
import { AttendanceService } from './attendance.service';
import { WorkforceAnalyticsService } from './analytics.service';
import { ScreenshotsService } from './screenshots.service';
import { WorkforceJobsService } from './workforce-jobs.service';
import {
  WorkforceAnalyticsController,
  WorkforceAttendanceController,
  WorkforceController,
  WorkforceScreenshotsController,
  WorkforceSettingsController,
} from './workforce.controller';

const SERVICES = [
  WorkforcePoliciesService,
  WorkSessionsService,
  WorkforceIngestService,
  WorkforceLiveService,
  AttendanceService,
  WorkforceAnalyticsService,
  ScreenshotsService,
  WorkforceJobsService,
];

/** Workforce: policies + app rules + classifier, ingest, sessions/attendance, live, analytics, screenshots, alert rules. */
@Module({
  controllers: [
    WorkforceController,
    WorkforceAttendanceController,
    WorkforceSettingsController,
    WorkforceAnalyticsController,
    WorkforceScreenshotsController,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class WorkforceModule {}
