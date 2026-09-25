import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OsPlatform, Prisma, RiskLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { deviceScope, deviceScopeSql, isScoped, scopedDepartmentIds, viaDevice } from '../common/scope';
import type { AuthUser } from '../common/types';

export class TrendQueryDto {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}
export class LimitQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async summary(user?: AuthUser) {
    const base: Prisma.DeviceWhereInput = { AND: [deviceScope(user), { status: { not: 'RETIRED' } }] };
    const dev = (extra: Prisma.DeviceWhereInput) => ({ AND: [base, extra] });
    const now = Date.now();
    const scopeSql = deviceScopeSql(user);
    const alertScope = isScoped(user) ? viaDevice(user) : {};
    const [
      totalDevices, compliant, nonCompliant, unknown, avg, critical, high, usb24, usb7,
      sw, enc, av, patchAgg, online, openAlerts, byPlatform, byRisk,
    ] = await Promise.all([
      this.prisma.device.count({ where: base }),
      this.prisma.device.count({ where: dev({ complianceState: 'COMPLIANT' }) }),
      this.prisma.device.count({ where: dev({ complianceState: 'NON_COMPLIANT' }) }),
      this.prisma.device.count({ where: dev({ complianceState: 'UNKNOWN' }) }),
      this.prisma.device.aggregate({ where: dev({ lastEvaluatedAt: { not: null } }), _avg: { complianceScore: true } }),
      this.prisma.device.count({ where: dev({ riskLevel: 'CRITICAL' }) }),
      this.prisma.device.count({ where: dev({ riskLevel: 'HIGH' }) }),
      this.prisma.usbEvent.count({ where: { eventType: 'BLOCKED', occurredAt: { gte: new Date(now - 86_400_000) }, device: base } }),
      this.prisma.usbEvent.count({ where: { eventType: 'BLOCKED', occurredAt: { gte: new Date(now - 7 * 86_400_000) }, device: base } }),
      this.prisma.$queryRaw<{ unauthorized: bigint; blacklisted: bigint; devices: bigint }[]>`
        SELECT count(*) FILTER (WHERE s.status = 'UNAUTHORIZED')::bigint AS unauthorized,
               count(*) FILTER (WHERE s.status = 'BLACKLISTED')::bigint AS blacklisted,
               count(DISTINCT s.device_id)::bigint AS devices
        FROM software_inventory s JOIN devices d ON d.id = s.device_id
        WHERE s.removed_at IS NULL AND s.status IN ('UNAUTHORIZED','BLACKLISTED') AND d.status <> 'RETIRED' AND ${scopeSql}`,
      this.prisma.$queryRaw<{ yes: bigint; no: bigint; unk: bigint }[]>`
        SELECT count(*) FILTER (WHERE s.disk_encryption_state = 'ENABLED')::bigint AS yes,
               count(*) FILTER (WHERE s.disk_encryption_state IN ('DISABLED','NOT_INSTALLED','OUTDATED'))::bigint AS no,
               count(*) FILTER (WHERE s.id IS NULL OR s.disk_encryption_state = 'UNKNOWN')::bigint AS unk
        FROM devices d LEFT JOIN security_status s ON s.device_id = d.id
        WHERE d.status <> 'RETIRED' AND ${scopeSql}`,
      this.prisma.$queryRaw<{ yes: bigint; no: bigint; unk: bigint }[]>`
        SELECT count(*) FILTER (WHERE s.antivirus_state = 'ENABLED')::bigint AS yes,
               count(*) FILTER (WHERE s.antivirus_state IN ('DISABLED','NOT_INSTALLED','OUTDATED'))::bigint AS no,
               count(*) FILTER (WHERE s.id IS NULL OR s.antivirus_state = 'UNKNOWN')::bigint AS unk
        FROM devices d LEFT JOIN security_status s ON s.device_id = d.id
        WHERE d.status <> 'RETIRED' AND ${scopeSql}`,
      this.prisma.$queryRaw<{ uptodate: bigint; critical: bigint; missing: bigint; withmissing: bigint }[]>`
        SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM patch_status p WHERE p.device_id = d.id AND p.state IN ('MISSING','FAILED')))::bigint AS uptodate,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM patch_status p WHERE p.device_id = d.id AND p.state = 'MISSING' AND p.severity = 'CRITICAL'))::bigint AS critical,
               COALESCE(sum((SELECT count(*) FROM patch_status p WHERE p.device_id = d.id AND p.state = 'MISSING')), 0)::bigint AS missing,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM patch_status p WHERE p.device_id = d.id AND p.state = 'MISSING'))::bigint AS withmissing
        FROM devices d WHERE d.status <> 'RETIRED' AND ${scopeSql}`,
      this.prisma.device.count({ where: dev({ lastSeenAt: { gte: new Date(now - 15 * 60_000) } }) }),
      this.prisma.alert.groupBy({
        by: ['severity'],
        where: { AND: [alertScope, { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }] },
        _count: { _all: true },
      }),
      this.prisma.device.groupBy({ by: ['platform'], where: base, _count: { _all: true } }),
      this.prisma.device.groupBy({ by: ['riskLevel'], where: base, _count: { _all: true } }),
    ]);
    const alertCount = (s?: string) =>
      openAlerts.filter((a) => !s || a.severity === s).reduce((n, a) => n + a._count._all, 0);
    return {
      totalDevices,
      compliantDevices: compliant,
      nonCompliantDevices: nonCompliant,
      unknownDevices: unknown,
      complianceRate: totalDevices ? round1((compliant / totalDevices) * 100) : 0,
      averageScore: round1(avg._avg.complianceScore ?? 0),
      criticalRisks: critical,
      highRisks: high,
      usbViolations: { last24h: usb24, last7d: usb7 },
      softwareViolations: {
        unauthorized: Number(sw[0]?.unauthorized ?? 0),
        blacklisted: Number(sw[0]?.blacklisted ?? 0),
        devicesAffected: Number(sw[0]?.devices ?? 0),
      },
      encryption: { encrypted: Number(enc[0]?.yes ?? 0), notEncrypted: Number(enc[0]?.no ?? 0), unknown: Number(enc[0]?.unk ?? 0) },
      antivirus: { protected: Number(av[0]?.yes ?? 0), unprotected: Number(av[0]?.no ?? 0), unknown: Number(av[0]?.unk ?? 0) },
      patches: {
        upToDate: Number(patchAgg[0]?.uptodate ?? 0),
        missingCritical: Number(patchAgg[0]?.critical ?? 0),
        missingTotal: Number(patchAgg[0]?.missing ?? 0),
        devicesWithMissing: Number(patchAgg[0]?.withmissing ?? 0),
      },
      onlineDevices: online,
      openAlerts: { total: alertCount(), critical: alertCount('CRITICAL'), high: alertCount('HIGH') },
      byPlatform: Object.values(OsPlatform).map((platform) => ({
        platform,
        count: byPlatform.find((p) => p.platform === platform)?._count._all ?? 0,
      })),
      byRisk: Object.values(RiskLevel).map((riskLevel) => ({
        riskLevel,
        count: byRisk.find((r) => r.riskLevel === riskLevel)?._count._all ?? 0,
      })),
    };
  }

  /**
   * Daily trend: for each day, the last evaluation of each device that day
   * (carried forward from earlier days when a device was not evaluated).
   */
  async trend(days: number, user?: AuthUser) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const lookback = new Date(start.getTime() - 30 * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ day: string; rate: number | null; avg: number | null }[]>`
      WITH days AS (
        SELECT generate_series(${start}::timestamp, date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS day
      ),
      daily AS (
        SELECT DISTINCT ON (cr.device_id, date_trunc('day', cr.evaluated_at))
               cr.device_id, date_trunc('day', cr.evaluated_at) AS day, cr.state, cr.score
        FROM compliance_results cr JOIN devices d ON d.id = cr.device_id
        WHERE cr.evaluated_at >= ${lookback} AND d.status <> 'RETIRED' AND ${deviceScopeSql(user)}
        ORDER BY cr.device_id, date_trunc('day', cr.evaluated_at), cr.evaluated_at DESC
      ),
      snap AS (
        SELECT dy.day, x.state, x.score
        FROM days dy
        CROSS JOIN LATERAL (
          SELECT DISTINCT ON (dl.device_id) dl.device_id, dl.state, dl.score
          FROM daily dl WHERE dl.day <= dy.day
          ORDER BY dl.device_id, dl.day DESC
        ) x
      )
      SELECT to_char(dy.day, 'YYYY-MM-DD') AS day,
             (count(s.state) FILTER (WHERE s.state = 'COMPLIANT') * 100.0 / NULLIF(count(s.state), 0))::float8 AS rate,
             avg(s.score)::float8 AS avg
      FROM days dy LEFT JOIN snap s ON s.day = dy.day
      GROUP BY dy.day ORDER BY dy.day`;
    return rows.map((r) => ({ date: r.day, complianceRate: round1(r.rate ?? 0), averageScore: round1(r.avg ?? 0) }));
  }

  async topViolations(limit: number, user?: AuthUser) {
    const rows = await this.prisma.$queryRaw<{ ruleKey: string; name: string; severity: string; deviceCount: bigint }[]>`
      SELECT f->>'ruleKey' AS "ruleKey", max(f->>'name') AS name, max(f->>'severity') AS severity,
             count(DISTINCT latest.device_id)::bigint AS "deviceCount"
      FROM (
        SELECT DISTINCT ON (cr.device_id) cr.device_id, cr.findings
        FROM compliance_results cr JOIN devices d ON d.id = cr.device_id
        WHERE d.status <> 'RETIRED' AND ${deviceScopeSql(user)}
        ORDER BY cr.device_id, cr.evaluated_at DESC
      ) latest, jsonb_array_elements(latest.findings) f
      WHERE (f->>'passed')::boolean = false
      GROUP BY 1 ORDER BY 4 DESC, 1 LIMIT ${limit}`;
    return rows.map((r) => ({ ...r, deviceCount: Number(r.deviceCount) }));
  }

  recentAlerts(limit: number, user?: AuthUser) {
    return this.alerts.recent(limit, user);
  }

  async departmentCompliance(user?: AuthUser) {
    const deptWhere: Prisma.DepartmentWhereInput = isScoped(user)
      ? user!.roleKey === 'EMPLOYEE'
        ? { id: { in: user!.departmentId ? [user!.departmentId] : [] } }
        : { id: { in: scopedDepartmentIds(user!) } }
      : {};
    const [depts, groups] = await Promise.all([
      this.prisma.department.findMany({ where: deptWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.device.groupBy({
        by: ['departmentId', 'complianceState'],
        where: { AND: [deviceScope(user), { status: { not: 'RETIRED' } }] },
        _count: { _all: true },
      }),
    ]);
    return depts.map((d) => {
      const g = groups.filter((x) => x.departmentId === d.id);
      const total = g.reduce((n, x) => n + x._count._all, 0);
      const compliant = g.filter((x) => x.complianceState === 'COMPLIANT').reduce((n, x) => n + x._count._all, 0);
      return {
        departmentId: d.id,
        departmentName: d.name,
        total,
        compliant,
        complianceRate: total ? round1((compliant / total) * 100) : 0,
      };
    });
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@RequirePermissions('dashboard:read')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  @Get('compliance-trend')
  trend(@Query() q: TrendQueryDto, @CurrentUser() user: AuthUser) {
    return this.dashboard.trend(q.days ?? 30, user);
  }

  @Get('top-violations')
  topViolations(@Query() q: LimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.dashboard.topViolations(q.limit ?? 5, user);
  }

  @Get('recent-alerts')
  recentAlerts(@Query() q: LimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.dashboard.recentAlerts(q.limit ?? 10, user);
  }

  @Get('department-compliance')
  departmentCompliance(@CurrentUser() user: AuthUser) {
    return this.dashboard.departmentCompliance(user);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
