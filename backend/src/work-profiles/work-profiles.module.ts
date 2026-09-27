import { Module } from '@nestjs/common';
import { WorkProfilesController } from './work-profiles.controller';
import { WorkProfilesService } from './work-profiles.service';

@Module({
  controllers: [WorkProfilesController],
  providers: [WorkProfilesService],
  exports: [WorkProfilesService],
})
export class WorkProfilesModule {}
