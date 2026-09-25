import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, ProtectionState } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto, orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { deviceScope, deviceScopeSql } from '../common/scope';
import type { AuthUser } from '../common/types';

export class SecurityDevicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProtectionState }) @IsOptional() @IsEnum(ProtectionState) antivirusState?: ProtectionState;
  @ApiPropertyOptional({ enum: ProtectionState }) @IsOptional() @IsEnum(ProtectionState) diskEncryptionState?: ProtectionState;
  @ApiPropertyOptional({ enum: ProtectionState }) @IsOptional() @IsEnum(ProtectionState) firewallState?: ProtectionState;
  @ApiPropertyOptional({ enum: ProtectionState }) @IsOptional() @IsEnum(ProtectionState) edrState?: ProtectionState;
  @ApiPropertyOptional({ enum: ProtectionState }) @IsOptional() @IsEnum(ProtectionState) secureBootState?: ProtectionState;
}

const COLUMNS: Record<string, string> = {
  antivirus: 'antivirus_state',
  edr: 'edr_state',
  firewall: 'firewall_state',
  diskEncryption: 'disk_encryption_state',
  secureBoot: 'secure_boot_state',
};

@Injectable()
export class SecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user?: AuthUser) {
    const scope = deviceScopeSql(user, 'd');
    const out: Record<string, { state: ProtectionState; count: number }[]> = {};
    for (const [key, col] of Object.entries(COLUMNS)) {
      const rows = await this.prisma.$queryRaw<{ state: ProtectionState; count: bigint }[]>`
        SELECT COALESCE(s.${Prisma.raw(col)}::text, 'UNKNOWN') AS state, count(*)::bigint AS count
        FROM devices d LEFT JOIN security_status s ON s.device_id = d.id
        WHERE d.status <> 'RETIRED' AND ${scope}
        GROUP BY 1 ORDER BY 1`;
      const counts = new Map(rows.map((r) => [r.state, Number(r.count)]));
      out[key] = Object.values(ProtectionState).map((state) => ({ state, count: counts.get(state) ?? 0 }));
    }
    // Screen lock compliance evaluated against each device's reported settings (<= 15 min & password on wake).
    const [sl] = await this.prisma.$queryRaw<{ compliant: bigint; noncompliant: bigint; unknown: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE s.id IS NOT NULL AND s.screen_lock_enabled = true AND COALESCE(s.password_on_wake, false) = true
                         AND COALESCE(s.screen_lock_timeout_sec, 0) <= 900)::bigint AS compliant,
        count(*) FILTER (WHERE s.id IS NOT NULL AND s.screen_lock_enabled IS NOT NULL AND NOT (s.screen_lock_enabled = true
                         AND COALESCE(s.password_on_wake, false) = true AND COALESCE(s.screen_lock_timeout_sec, 0) <= 900))::bigint AS noncompliant,
        count(*) FILTER (WHERE s.id IS NULL OR s.screen_lock_enabled IS NULL)::bigint AS unknown
      FROM devices d LEFT JOIN security_status s ON s.device_id = d.id
      WHERE d.status <> 'RETIRED' AND ${scope}`;
    return {
      antivirus: out.antivirus,
      edr: out.edr,
      firewall: out.firewall,
      diskEncryption: out.diskEncryption,
      secureBoot: out.secureBoot,
      screenLock: { compliant: Number(sl?.compliant ?? 0), nonCompliant: Number(sl?.noncompliant ?? 0), unknown: Number(sl?.unknown ?? 0) },
    };
  }

  async devices(q: SecurityDevicesQueryDto, user?: AuthUser) {
    const where: Prisma.SecurityStatusWhereInput = {
      device: {
        AND: [
          deviceScope(user),
          { status: { not: 'RETIRED' } },
          ...(q.search
            ? [{ OR: [{ deviceName: { contains: q.search, mode: 'insensitive' as const } }, { hostname: { contains: q.search, mode: 'insensitive' as const } }] }]
            : []),
        ],
      },
      ...(q.antivirusState ? { antivirusState: q.antivirusState } : {}),
      ...(q.diskEncryptionState ? { diskEncryptionState: q.diskEncryptionState } : {}),
      ...(q.firewallState ? { firewallState: q.firewallState } : {}),
      ...(q.edrState ? { edrState: q.edrState } : {}),
      ...(q.secureBootState ? { secureBootState: q.secureBootState } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.securityStatus.findMany({
        where,
        include: {
          device: {
            select: {
              id: true, deviceName: true, platform: true, complianceState: true, riskLevel: true,
              assignedUser: { select: { id: true, displayName: true, email: true } },
            },
          },
        },
        orderBy: orderBy(q, ['collectedAt', 'updatedAt', 'antivirusSignatureAt'], 'collectedAt'),
        ...skipTake(q),
      }),
      this.prisma.securityStatus.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }
}

@ApiTags('security')
@ApiBearerAuth()
@Controller('security')
@RequirePermissions('security:read')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.security.overview(user);
  }

  @Get('devices')
  devices(@Query() q: SecurityDevicesQueryDto, @CurrentUser() user: AuthUser) {
    return this.security.devices(q, user);
  }
}

@Module({
  controllers: [SecurityController],
  providers: [SecurityService],
})
export class SecurityModule {}
