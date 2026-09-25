import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { PatchCategory, PatchSeverity, PatchState, Prisma } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommandsService } from '../devices/commands.service';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto, paginated } from '../common/dto/pagination.dto';
import { deviceScope, deviceScopeSql } from '../common/scope';
import type { AuthUser } from '../common/types';

export class PatchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PatchSeverity }) @IsOptional() @IsEnum(PatchSeverity) severity?: PatchSeverity;
  @ApiPropertyOptional({ enum: PatchState }) @IsOptional() @IsEnum(PatchState) state?: PatchState;
  @ApiPropertyOptional({ enum: PatchCategory }) @IsOptional() @IsEnum(PatchCategory) category?: PatchCategory;
}

export class VulnerabilityQueryDto extends PaginationQueryDto {}

export class DeployPatchesDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10000) @IsUUID('all', { each: true }) deviceIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) @MaxLength(200, { each: true }) patchIds?: string[];
  @ApiPropertyOptional({ enum: PatchSeverity, isArray: true }) @IsOptional() @IsArray() @IsEnum(PatchSeverity, { each: true }) severity?: PatchSeverity[];
}

const SEVERITY_ORDER_SQL = Prisma.sql`CASE p.severity::text WHEN 'CRITICAL' THEN 0 WHEN 'IMPORTANT' THEN 1 WHEN 'MODERATE' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`;

@Injectable()
export class PatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commands: CommandsService,
  ) {}

  async list(q: PatchQueryDto, user?: AuthUser) {
    const conds: Prisma.Sql[] = [Prisma.sql`d.status <> 'RETIRED'`, deviceScopeSql(user)];
    if (q.severity) conds.push(Prisma.sql`p.severity::text = ${q.severity}`);
    if (q.category) conds.push(Prisma.sql`p.category::text = ${q.category}`);
    if (q.search) {
      const like = `%${q.search}%`;
      conds.push(Prisma.sql`(p.patch_id ILIKE ${like} OR p.title ILIKE ${like} OR ${q.search.toUpperCase()} = ANY(p.cve_ids))`);
    }
    const where = Prisma.join(conds, ' AND ');
    const having = q.state ? Prisma.sql`HAVING count(*) FILTER (WHERE p.state::text = ${q.state}) > 0` : Prisma.empty;
    const sort =
      q.sortBy === 'patchId' ? Prisma.sql`p.patch_id` :
      q.sortBy === 'title' ? Prisma.sql`max(p.title)` :
      q.sortBy === 'installedCount' ? Prisma.sql`count(*) FILTER (WHERE p.state = 'INSTALLED')` :
      q.sortBy === 'severity' ? Prisma.sql`min(${SEVERITY_ORDER_SQL})` :
      Prisma.sql`count(*) FILTER (WHERE p.state = 'MISSING')`;
    const dir = q.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (q.page - 1) * q.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<
        { patchId: string; title: string; severity: PatchSeverity; category: PatchCategory; cveIds: string[]; missingCount: bigint; installedCount: bigint; failedCount: bigint; cvssScore: number | null; releasedAt: Date | null }[]
      >`
        SELECT p.patch_id AS "patchId", max(p.title) AS title,
               (array_agg(p.severity::text ORDER BY ${SEVERITY_ORDER_SQL}))[1] AS severity,
               (array_agg(p.category::text))[1] AS category,
               COALESCE((SELECT array_agg(DISTINCT c) FROM patch_status p2, unnest(p2.cve_ids) AS c
                         WHERE p2.patch_id = p.patch_id), '{}') AS "cveIds",
               count(*) FILTER (WHERE p.state = 'MISSING')::bigint AS "missingCount",
               count(*) FILTER (WHERE p.state = 'INSTALLED')::bigint AS "installedCount",
               count(*) FILTER (WHERE p.state = 'FAILED')::bigint AS "failedCount",
               max(p.cvss_score) AS "cvssScore",
               max(p.released_at) AS "releasedAt"
        FROM patch_status p JOIN devices d ON d.id = p.device_id
        WHERE ${where}
        GROUP BY p.patch_id ${having}
        ORDER BY ${sort} ${dir}, p.patch_id ASC
        LIMIT ${q.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*)::bigint AS total FROM (
          SELECT p.patch_id FROM patch_status p JOIN devices d ON d.id = p.device_id
          WHERE ${where} GROUP BY p.patch_id ${having}) x`,
    ]);
    return paginated(
      rows.map((r) => ({
        ...r,
        missingCount: Number(r.missingCount),
        installedCount: Number(r.installedCount),
        failedCount: Number(r.failedCount),
      })),
      q.page,
      q.pageSize,
      Number(count[0]?.total ?? 0),
    );
  }

  async summary(user?: AuthUser) {
    const scope = deviceScopeSql(user);
    const [bySeverity, devices] = await Promise.all([
      this.prisma.$queryRaw<{ severity: PatchSeverity; missing: bigint }[]>`
        SELECT p.severity::text AS severity, count(*)::bigint AS missing
        FROM patch_status p JOIN devices d ON d.id = p.device_id
        WHERE p.state = 'MISSING' AND d.status <> 'RETIRED' AND ${scope}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ total: bigint; fully: bigint; critical: bigint; missing: bigint }[]>`
        SELECT count(*)::bigint AS total,
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM patch_status p WHERE p.device_id = d.id AND p.state IN ('MISSING','FAILED')))::bigint AS fully,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM patch_status p WHERE p.device_id = d.id AND p.state = 'MISSING' AND p.severity = 'CRITICAL'))::bigint AS critical,
               (SELECT count(*) FROM patch_status p JOIN devices d2 ON d2.id = p.device_id WHERE p.state = 'MISSING' AND d2.status <> 'RETIRED' AND ${deviceScopeSql(user, 'd2')})::bigint AS missing
        FROM devices d WHERE d.status <> 'RETIRED' AND ${scope}`,
    ]);
    const map = new Map(bySeverity.map((r) => [r.severity, Number(r.missing)]));
    return {
      bySeverity: Object.values(PatchSeverity).map((severity) => ({ severity, missing: map.get(severity) ?? 0 })),
      devicesFullyPatched: Number(devices[0]?.fully ?? 0),
      devicesMissingCritical: Number(devices[0]?.critical ?? 0),
      totalMissing: Number(devices[0]?.missing ?? 0),
    };
  }

  async vulnerabilities(q: VulnerabilityQueryDto, user?: AuthUser) {
    const scope = deviceScopeSql(user);
    const search = q.search ? Prisma.sql`AND cve ILIKE ${'%' + q.search + '%'}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ cveId: string; cvssScore: number | null; patchIds: string[]; affectedDevices: bigint }[]>`
      SELECT cve AS "cveId", max(p.cvss_score) AS "cvssScore",
             array_agg(DISTINCT p.patch_id) AS "patchIds",
             count(DISTINCT p.device_id)::bigint AS "affectedDevices"
      FROM patch_status p JOIN devices d ON d.id = p.device_id, unnest(p.cve_ids) AS cve
      WHERE p.state IN ('MISSING', 'FAILED') AND d.status <> 'RETIRED' AND ${scope} ${search}
      GROUP BY cve
      ORDER BY max(p.cvss_score) DESC NULLS LAST, count(DISTINCT p.device_id) DESC, cve
      LIMIT 2000`;
    // Contract: plain array (vulnerability report), not a paginated envelope.
    return rows.map((r) => ({ ...r, affectedDevices: Number(r.affectedDevices) }));
  }

  async deploy(dto: DeployPatchesDto, actor: AuthUser) {
    const patchFilter: Prisma.PatchStatusWhereInput = {
      state: { in: ['MISSING', 'FAILED'] },
      ...(dto.patchIds?.length ? { patchId: { in: dto.patchIds } } : {}),
      ...(dto.severity?.length ? { severity: { in: dto.severity } } : {}),
    };
    const devices = await this.prisma.device.findMany({
      where: {
        AND: [
          deviceScope(actor),
          { status: { in: ['ACTIVE', 'INACTIVE', 'QUARANTINED'] } },
          ...(dto.deviceIds?.length ? [{ id: { in: dto.deviceIds } }] : []),
          { patches: { some: patchFilter } },
        ],
      },
      select: { id: true },
    });
    const payload = {
      ...(dto.patchIds?.length ? { patchIds: dto.patchIds } : {}),
      ...(dto.severity?.length ? { severity: dto.severity } : {}),
      reboot: 'if-required',
    };
    const count = await this.commands.createMany(devices.map((d) => d.id), 'INSTALL_PATCHES', payload, { createdById: actor.id });
    await this.prisma.patchStatus.updateMany({
      where: { ...patchFilter, deviceId: { in: devices.map((d) => d.id) }, state: 'MISSING' },
      data: { state: 'PENDING_INSTALL' },
    });
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'patches.deploy',
      resourceType: 'PatchStatus',
      after: { ...payload, deviceCount: count },
    });
    return { commands: count };
  }
}

@ApiTags('patches')
@ApiBearerAuth()
@Controller('patches')
export class PatchesController {
  constructor(private readonly patches: PatchesService) {}

  @Get()
  @RequirePermissions('patches:read')
  list(@Query() q: PatchQueryDto, @CurrentUser() user: AuthUser) {
    return this.patches.list(q, user);
  }

  @Get('summary')
  @RequirePermissions('patches:read')
  summary(@CurrentUser() user: AuthUser) {
    return this.patches.summary(user);
  }

  @Get('vulnerabilities')
  @RequirePermissions('patches:read')
  vulnerabilities(@Query() q: VulnerabilityQueryDto, @CurrentUser() user: AuthUser) {
    return this.patches.vulnerabilities(q, user);
  }

  @Post('deploy')
  @RequirePermissions('patches:deploy')
  @HttpCode(200)
  deploy(@Body() dto: DeployPatchesDto, @CurrentUser() user: AuthUser) {
    return this.patches.deploy(dto, user);
  }
}

@Module({
  controllers: [PatchesController],
  providers: [PatchesService],
})
export class PatchesModule {}
