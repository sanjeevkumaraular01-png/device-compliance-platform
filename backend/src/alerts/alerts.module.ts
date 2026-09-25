import { Global, Module } from '@nestjs/common';
import { workerOnly } from '../config/role';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { ChannelsService } from './channels.service';
import { NotifierService } from './notifier.service';
import { AlertsProcessor } from './alerts.processor';

@Global()
@Module({
  controllers: [AlertsController],
  providers: [AlertsService, ChannelsService, NotifierService, ...workerOnly(AlertsProcessor)],
  exports: [AlertsService, ChannelsService, NotifierService],
})
export class AlertsModule {}
