import { Global, Module } from '@nestjs/common';
import { UsbController } from './usb.controller';
import { UsbService } from './usb.service';

@Global()
@Module({
  controllers: [UsbController],
  providers: [UsbService],
  exports: [UsbService],
})
export class UsbModule {}
