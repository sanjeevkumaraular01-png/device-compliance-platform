import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { DeployController } from './deploy.controller';
import { DeployService } from './deploy.service';
import { MailVerifier } from './mail-verifier';

@Module({
  imports: [HrModule],
  controllers: [DeployController],
  providers: [DeployService, MailVerifier],
  exports: [DeployService],
})
export class DeployModule {}
