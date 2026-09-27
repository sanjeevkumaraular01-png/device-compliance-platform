import { Module } from '@nestjs/common';
import { DeviceGroupsController } from './device-groups.controller';
import { DeviceGroupsService } from './device-groups.service';

@Module({
  controllers: [DeviceGroupsController],
  providers: [DeviceGroupsService],
  exports: [DeviceGroupsService],
})
export class DeviceGroupsModule {}
