import { Global, Module } from '@nestjs/common';
import { workerOnly } from '../config/role';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportDataService } from './report-data.service';
import { ReportsProcessor } from './reports.processor';

@Global()
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportDataService, ...workerOnly(ReportsProcessor)],
  exports: [ReportsService],
})
export class ReportsModule {}
