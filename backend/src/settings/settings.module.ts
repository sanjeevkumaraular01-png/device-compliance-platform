import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { IpRestrictionGuard } from './ip-restriction.guard';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, IpRestrictionGuard],
  exports: [SettingsService, IpRestrictionGuard],
})
export class SettingsModule {}
