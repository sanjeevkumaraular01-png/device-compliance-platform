import { Module } from '@nestjs/common';
import { DeployController } from './deploy.controller';
import { DeployService } from './deploy.service';
import { MailVerifier } from './mail-verifier';

@Module({
  controllers: [DeployController],
  providers: [DeployService, MailVerifier],
  exports: [DeployService],
})
export class DeployModule {}
