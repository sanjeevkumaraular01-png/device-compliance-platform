import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { RUN_WORKER } from './config/role';
import { PrismaModule } from './prisma/prisma.module';
import Redis from 'ioredis';
import { REDIS, RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './common/throttler-redis.storage';
import { QueuesModule } from './queues/queues.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { MetricsModule } from './metrics/metrics.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { IpRestrictionGuard } from './settings/ip-restriction.guard';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { DepartmentsModule } from './departments/departments.module';
import { CommandsModule } from './devices/commands.service';
import { PoliciesModule } from './policies/policies.module';
import { WorkProfilesModule } from './work-profiles/work-profiles.module';
import { AlertsModule } from './alerts/alerts.module';
import { ComplianceModule } from './compliance/compliance.module';
import { DevicesModule } from './devices/devices.module';
import { DeviceGroupsModule } from './device-groups/device-groups.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { DeployModule } from './deploy/deploy.module';
import { SoftwareModule } from './software/software.module';
import { UsbModule } from './usb/usb.module';
import { SecurityModule } from './security/security.module';
import { PatchesModule } from './patches/patches.module';
import { AgentModule } from './agent/agent.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { WorkforceModule } from './workforce/workforce.module';
import { TasksModule } from './tasks/tasks.module';
import { DailyReportsModule } from './daily-reports/daily-reports.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.logLevel,
          genReqId: (req) => (req as unknown as { id?: string }).id ?? '',
          customProps: () => ({ app: 'secureendpoint-backend' }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-device-id"]',
              'res.headers["set-cookie"]',
              '*.password',
              '*.refreshToken',
              '*.accessToken',
              '*.agentToken',
              '*.enrollmentToken',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url?.split('?')[0],
              remoteAddress: req.remoteAddress,
            }),
          },
          autoLogging: {
            ignore: (req) => {
              const url = (req as { url?: string }).url ?? '';
              return url.startsWith('/metrics') || url.startsWith('/api/v1/health');
            },
          },
          transport: config.isProduction || config.nodeEnv === 'test' ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [AppConfigService, REDIS],
      useFactory: (config: AppConfigService, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: config.rateLimitTtl * 1000, limit: config.rateLimitMax }],
        // Counters live in Redis so limits hold across all API replicas.
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    PrismaModule,
    RedisModule,
    QueuesModule,
    CommonModule,
    MetricsModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    RolesModule,
    DepartmentsModule,
    CommandsModule,
    PoliciesModule,
    WorkProfilesModule,
    AlertsModule,
    ComplianceModule,
    DevicesModule,
    DeviceGroupsModule,
    EnrollmentModule,
    DeployModule,
    SoftwareModule,
    UsbModule,
    SecurityModule,
    PatchesModule,
    AgentModule,
    ReportsModule,
    DashboardModule,
    HealthModule,
    WorkforceModule,
    TasksModule,
    DailyReportsModule,
    AiModule,
    ...(RUN_WORKER ? [JobsModule] : []),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Guard order: rate limit -> IP allow-list -> JWT -> permissions
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: IpRestrictionGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
