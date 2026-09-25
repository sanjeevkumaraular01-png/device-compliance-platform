import { Global, Module } from '@nestjs/common';
import { CaService } from './ca.service';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';

@Global()
@Module({
  controllers: [EnrollmentController],
  providers: [CaService, EnrollmentService],
  exports: [CaService, EnrollmentService],
})
export class EnrollmentModule {}
