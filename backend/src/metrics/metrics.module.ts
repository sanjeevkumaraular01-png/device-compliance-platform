import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsCollector } from './metrics.collector';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsCollector],
  exports: [MetricsService, MetricsCollector],
})
export class MetricsModule {}
