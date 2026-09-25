import { Global, Module } from '@nestjs/common';
import { workerOnly } from '../config/role';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ComplianceProcessor } from './compliance.processor';

@Global()
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, ...workerOnly(ComplianceProcessor)],
  exports: [ComplianceService],
})
export class ComplianceModule {}
