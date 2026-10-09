import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { NoticeService } from './notice.service';

@Module({
  imports: [UsersModule, DevicesModule],
  controllers: [HrController],
  providers: [HrService, NoticeService],
  exports: [NoticeService],
})
export class HrModule {}
