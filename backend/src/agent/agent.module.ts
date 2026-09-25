import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from '../common/guards/agent-auth.guard';
import { WorkforceModule } from '../workforce/workforce.module';

@Module({
  imports: [WorkforceModule],
  controllers: [AgentController],
  providers: [AgentService, AgentAuthGuard],
})
export class AgentModule {}
