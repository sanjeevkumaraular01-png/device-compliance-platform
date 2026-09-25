import { Module } from '@nestjs/common';
import { WorkforceModule } from '../workforce/workforce.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/** AI Work Intelligence (Claude): nightly Message Batch + on-demand insights. */
@Module({
  imports: [WorkforceModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
