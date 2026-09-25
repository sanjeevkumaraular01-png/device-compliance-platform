import { Module } from '@nestjs/common';
import { WorkforceModule } from '../workforce/workforce.module';
import { ProjectsController, TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Projects, tasks, timers, time entries, import + webhook (docs/WORKFORCE.md). */
@Module({
  imports: [WorkforceModule],
  controllers: [ProjectsController, TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
