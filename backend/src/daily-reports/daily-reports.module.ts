import { Module } from '@nestjs/common';
import { WorkforceModule } from '../workforce/workforce.module';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';

/** Daily work reports: auto-draft, validation (vague-text rejection), review. */
@Module({
  imports: [WorkforceModule],
  controllers: [DailyReportsController],
  providers: [DailyReportsService],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
