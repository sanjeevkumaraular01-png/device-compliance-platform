import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OsPlatform, Prisma, SoftwareBlacklist, SoftwareWhitelist } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { CommandsService } from '../devices/commands.service';
import { PoliciesService } from '../policies/policies.service';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { deviceScope, deviceScopeSql } from '../common/scope';
import type { AuthUser } from '../common/types';
import { classifySoftware, ClassifiableSoftware, Classification } from './software.classifier';
import {
  CatalogQueryDto,
  CreateBlacklistDto,
  CreateWhitelistDto,
  InventoryQueryDto,
  UnauthorizedQueryDto,
  UpdateBlacklistDto,
  UpdateWhitelistDto,
} from './software.dto';

const CATALOG_CACHE_MS = 30_000;

@Injectable()
export class SoftwareService {
  private catalogCache: { at: number; whitelist: SoftwareWhitelist[]; blacklist: SoftwareBlacklist[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly commands: CommandsService,
    private readonly policies: PoliciesService,
  ) {}

  async catalog() {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_CACHE_MS) return this.catalogCache;
    const [whitelist, blacklist] = await Promise.all([
      this.prisma.softwareWhitelist.findMany(),
      this.prisma.softwareBlacklist.findMany(),
    ]);
    this.catalogCache = { at: Date.now(), whitelist, blacklist };
    return this.catalogCache;
  }

  private invalidate() {
    this.catalogCache = null;
  }

  async classify(item: ClassifiableSoftware, platform: OsPlatform, blockUnauthorized: boolean): Promise<Classification> {
    const { whitelist, blacklist } = await this.catalog();
    return classifySoftware(item, whitelist, blacklist, { platform, blockUnauthorized });
  }

  // ── Aggregated inventory ──
  async inventory(q: InventoryQueryDto, user?: AuthUser) {
    const conds: Prisma.Sql[] = [Prisma.sql`s.removed_at IS NULL`, Prisma.sql`d.status <> 'RETIRED'`, deviceScopeSql(user)];
    if (q.platform) conds.push(Prisma.sql`d.platform::text = ${q.platform}`);
    if (q.search) {
      const like = `%${q.search}%`;
      conds.push(Prisma.sql`(s.name ILIKE ${like} OR s.publisher ILIKE ${like})`);
    }
    const where = Prisma.join(conds, ' AND ');
    const having = q.status ? Prisma.sql`HAVING ${aggStatusSql} = ${q.status}` : Prisma.empty;
    const sortCol =
      q.sortBy === 'name' ? Prisma.sql`s.name` : q.sortBy === 'publisher' ? Prisma.sql`max(s.publisher)` : Prisma.sql`count(DISTINCT s.device_id)`;
    const dir = q.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (q.page - 1) * q.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<{ name: string; publisher: string | null; versions: string[]; installCount: bigint; status: string }[]>`
        SELECT s.name, max(s.publisher) AS publisher,
               array_agg(DISTINCT s.version) AS versions,
               count(DISTINCT s.device_id)::bigint AS "installCount",
               ${aggStatusSql} AS status
        FROM software_inventory s JOIN devices d ON d.id = s.device_id
        WHERE ${where}
        GROUP BY s.name ${having}
        ORDER BY ${sortCol} ${dir}, s.name ASC
        LIMIT ${q.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*)::bigint AS total FROM (
          SELECT s.name FROM software_inventory s JOIN devices d ON d.id = s.device_id
          WHERE ${where} GROUP BY s.name ${having}) x`,
    ]);
    return paginated(
      rows.map((r) => ({ ...r, versions: r.versions.filter((v) => v !== '').sort(), installCount: Number(r.installCount) })),
      q.page,
      q.pageSize,
      Number(count[0]?.total ?? 0),
    );
  }

  async devicesWith(name: string, q: InventoryQueryDto, user?: AuthUser) {
    const where: Prisma.SoftwareInventoryWhereInput = {
      name,
      removedAt: null,
      device: { AND: [deviceScope(user), { status: { not: 'RETIRED' } }, ...(q.platform ? [{ platform: q.platform }] : [])] },
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.softwareInventory.findMany({
        where,
        include: {
          device: {
            select: {
              id: true, deviceName: true, hostname: true, platform: true, complianceState: true, lastSeenAt: true,
              assignedUser: { select: { id: true, displayName: true, email: true } },
              department: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: orderBy(q, ['lastSeenAt', 'firstSeenAt', 'version', 'installDate'], 'lastSeenAt'),
        ...skipTake(q),
      }),
      this.prisma.softwareInventory.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async unauthorized(q: UnauthorizedQueryDto, user?: AuthUser) {
    const status = q.status && ['UNAUTHORIZED', 'BLACKLISTED'].includes(q.status) ? [q.status] : (['UNAUTHORIZED', 'BLACKLISTED'] as const);
    const deviceWhere: Prisma.DeviceWhereInput = {
      AND: [
        deviceScope(user),
        { status: { not: 'RETIRED' } },
        ...(q.platform ? [{ platform: q.platform }] : []),
        ...(q.departmentId ? [{ departmentId: q.departmentId }] : []),
      ],
    };
    const where: Prisma.SoftwareInventoryWhereInput = {
      removedAt: null,
      status: { in: [...status] },
      device: deviceWhere,
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { publisher: { contains: q.search, mode: 'insensitive' as const } },
              { device: { deviceName: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.softwareInventory.findMany({
        where,
        include: {
          device: {
            select: {
              id: true, deviceName: true, platform: true,
              assignedUser: { select: { id: true, displayName: true, email: true } },
            },
          },
        },
        orderBy: orderBy(q, ['firstSeenAt', 'lastSeenAt', 'name', 'status'], 'firstSeenAt'),
        ...skipTake(q),
      }),
      this.prisma.softwareInventory.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  // ── Whitelist ──
  private serializeWhitelist(w: SoftwareWhitelist) {
    const { licenseKeyEnc, ...rest } = w;
    return { ...rest, hasLicenseKey: !!licenseKeyEnc };
  }

  async listWhitelist(q: CatalogQueryDto) {
    const where: Prisma.SoftwareWhitelistWhereInput = {
      ...(q.platform ? { OR: [{ platform: q.platform }, { platform: null }] } : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: q.search, mode: 'insensitive' as const } },
                  { publisher: { contains: q.search, mode: 'insensitive' as const } },
                  { category: { contains: q.search, mode: 'insensitive' as const } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.softwareWhitelist.findMany({
        where,
        orderBy: orderBy({ sortBy: q.sortBy, sortOrder: q.sortBy ? q.sortOrder : 'asc' }, ['name', 'publisher', 'category', 'createdAt', 'licenseExpiresAt'], 'name'),
        ...skipTake(q),
      }),
      this.prisma.softwareWhitelist.count({ where }),
    ]);
    return paginated(rows.map((r) => this.serializeWhitelist(r)), q.page, q.pageSize, total);
  }

  async getWhitelist(id: string) {
    const w = await this.prisma.softwareWhitelist.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Whitelist entry not found');
    return this.serializeWhitelist(w);
  }

  private whitelistData(dto: UpdateWhitelistDto): Prisma.SoftwareWhitelistUncheckedUpdateInput {
    const { licenseKey, matchType, ...rest } = dto;
    const data: Prisma.SoftwareWhitelistUncheckedUpdateInput = { ...rest };
    if (matchType) data.matchType = matchType;
    if (licenseKey !== undefined) data.licenseKeyEnc = licenseKey ? this.crypto.encrypt(licenseKey) : null;
    if (dto.matchType === 'REGEX' && dto.name) this.assertRegex(dto.name);
    return data;
  }

  private assertRegex(pattern: string) {
    try {
      new RegExp(pattern);
    } catch {
      throw new BadRequestException('name is not a valid regular expression');
    }
  }

  async createWhitelist(dto: CreateWhitelistDto, actor: AuthUser) {
    const dup = await this.prisma.softwareWhitelist.findFirst({ where: { name: dto.name, platform: dto.platform ?? null } });
    if (dup) throw new ConflictException('Whitelist entry already exists for this name and platform');
    const w = await this.prisma.softwareWhitelist.create({
      data: { ...(this.whitelistData(dto) as Prisma.SoftwareWhitelistUncheckedCreateInput), name: dto.name, approvedById: actor.id },
    });
    this.invalidate();
    const out = this.serializeWhitelist(w);
    await this.audit.log({ category: 'SOFTWARE', action: 'software.whitelist.create', resourceType: 'SoftwareWhitelist', resourceId: w.id, after: out });
    return out;
  }

  async updateWhitelist(id: string, dto: UpdateWhitelistDto) {
    const before = await this.getWhitelist(id);
    const w = await this.prisma.softwareWhitelist.update({ where: { id }, data: this.whitelistData(dto) });
    this.invalidate();
    const out = this.serializeWhitelist(w);
    await this.audit.log({ category: 'SOFTWARE', action: 'software.whitelist.update', resourceType: 'SoftwareWhitelist', resourceId: id, before, after: out });
    return out;
  }

  async deleteWhitelist(id: string) {
    const before = await this.getWhitelist(id);
    await this.prisma.softwareWhitelist.delete({ where: { id } });
    this.invalidate();
    await this.audit.log({ category: 'SOFTWARE', action: 'software.whitelist.delete', resourceType: 'SoftwareWhitelist', resourceId: id, before });
  }

  // ── Blacklist ──
  async listBlacklist(q: CatalogQueryDto) {
    const where: Prisma.SoftwareBlacklistWhereInput = {
      ...(q.platform ? { OR: [{ platform: q.platform }, { platform: null }] } : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: q.search, mode: 'insensitive' as const } },
                  { reason: { contains: q.search, mode: 'insensitive' as const } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.softwareBlacklist.findMany({
        where,
        orderBy: orderBy({ sortBy: q.sortBy, sortOrder: q.sortBy ? q.sortOrder : 'asc' }, ['name', 'severity', 'createdAt'], 'name'),
        ...skipTake(q),
      }),
      this.prisma.softwareBlacklist.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async getBlacklist(id: string) {
    const b = await this.prisma.softwareBlacklist.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Blacklist entry not found');
    return b;
  }

  async createBlacklist(dto: CreateBlacklistDto, actor: AuthUser) {
    if (dto.matchType === 'REGEX') this.assertRegex(dto.name);
    const dup = await this.prisma.softwareBlacklist.findFirst({ where: { name: dto.name, platform: dto.platform ?? null } });
    if (dup) throw new ConflictException('Blacklist entry already exists for this name and platform');
    const b = await this.prisma.softwareBlacklist.create({
      data: {
        name: dto.name,
        publisher: dto.publisher ?? null,
        matchType: dto.matchType ?? 'CONTAINS',
        platform: dto.platform ?? null,
        reason: dto.reason,
        severity: dto.severity ?? 'HIGH',
        autoUninstall: dto.autoUninstall ?? false,
        createdById: actor.id,
      },
    });
    this.invalidate();
    await this.audit.log({ category: 'SOFTWARE', action: 'software.blacklist.create', resourceType: 'SoftwareBlacklist', resourceId: b.id, after: b });
    return b;
  }

  async updateBlacklist(id: string, dto: UpdateBlacklistDto) {
    const before = await this.getBlacklist(id);
    if ((dto.matchType ?? before.matchType) === 'REGEX') this.assertRegex(dto.name ?? before.name);
    const data: Prisma.SoftwareBlacklistUpdateInput = { ...dto };
    if (dto.matchType === null) delete data.matchType;
    if (dto.severity === null) delete data.severity;
    const b = await this.prisma.softwareBlacklist.update({ where: { id }, data });
    this.invalidate();
    await this.audit.log({ category: 'SOFTWARE', action: 'software.blacklist.update', resourceType: 'SoftwareBlacklist', resourceId: id, before, after: b });
    return b;
  }

  async deleteBlacklist(id: string) {
    const before = await this.getBlacklist(id);
    await this.prisma.softwareBlacklist.delete({ where: { id } });
    this.invalidate();
    await this.audit.log({ category: 'SOFTWARE', action: 'software.blacklist.delete', resourceType: 'SoftwareBlacklist', resourceId: id, before });
  }

  async uninstall(deviceIds: string[], name: string, version: string | undefined, actor: AuthUser) {
    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds }, status: { in: ['ACTIVE', 'INACTIVE', 'QUARANTINED'] } },
      select: { id: true },
    });
    const count = await this.commands.createMany(
      devices.map((d) => d.id),
      'UNINSTALL_SOFTWARE',
      { name, ...(version ? { version } : {}) },
      { createdById: actor.id },
    );
    await this.audit.log({
      category: 'SOFTWARE',
      action: 'software.uninstall.request',
      resourceType: 'Software',
      resourceId: name,
      after: { name, version, deviceCount: count },
    });
    return { commands: count };
  }

  async licenses() {
    const entries = await this.prisma.softwareWhitelist.findMany({
      where: { OR: [{ licenseCount: { not: null } }, { licenseType: { notIn: ['FREE'] } }] },
      orderBy: { name: 'asc' },
    });
    const now = new Date();
    const out = [];
    for (const w of entries) {
      if (!w.licenseType && w.licenseCount == null) continue;
      const installed = await this.prisma.softwareInventory.findMany({
        where: { matchedRuleId: w.id, removedAt: null, device: { status: { not: 'RETIRED' } } },
        distinct: ['deviceId'],
        select: { deviceId: true },
      });
      const count = installed.length;
      const available = w.licenseCount == null ? 0 : Math.max(0, w.licenseCount - count);
      const compliance =
        w.licenseExpiresAt && w.licenseExpiresAt < now
          ? 'EXPIRED'
          : w.licenseCount != null && count > w.licenseCount
            ? 'OVER'
            : 'OK';
      out.push({
        id: w.id,
        name: w.name,
        publisher: w.publisher,
        licenseType: w.licenseType,
        licenseCount: w.licenseCount,
        installed: count,
        available,
        compliance,
        licenseExpiresAt: w.licenseExpiresAt,
        costPerSeat: w.costPerSeat,
      });
    }
    return out;
  }

  /** Re-run whitelist/blacklist matching on all active inventory. */
  async reclassify(actor?: AuthUser) {
    this.invalidate();
    const { whitelist, blacklist } = await this.catalog();
    const devices = await this.prisma.device.findMany({
      where: { status: { not: 'RETIRED' } },
      select: { id: true, platform: true, policyId: true, departmentId: true },
    });
    let updated = 0;
    const affectedDevices = new Set<string>();
    for (const d of devices) {
      const { policy } = await this.policies.resolveForDevice(d);
      const items = await this.prisma.softwareInventory.findMany({ where: { deviceId: d.id, removedAt: null } });
      for (const item of items) {
        const c = classifySoftware(item, whitelist, blacklist, { platform: d.platform, blockUnauthorized: policy.blockUnauthorizedSoftware });
        if (c.status !== item.status || c.matchedRuleId !== item.matchedRuleId) {
          await this.prisma.softwareInventory.update({ where: { id: item.id }, data: { status: c.status, matchedRuleId: c.matchedRuleId } });
          updated++;
          affectedDevices.add(d.id);
        }
      }
    }
    await this.policies.queueEvaluation([...affectedDevices]);
    await this.audit.log({
      category: 'SOFTWARE',
      action: 'software.reclassify',
      actorType: actor ? 'USER' : 'SYSTEM',
      resourceType: 'SoftwareInventory',
      after: { updated, devices: affectedDevices.size },
    });
    return { updated };
  }
}

/** Worst status across installations of one software name. */
const aggStatusSql = Prisma.sql`(array_agg(s.status::text ORDER BY CASE s.status::text WHEN 'BLACKLISTED' THEN 0 WHEN 'UNAUTHORIZED' THEN 1 WHEN 'UNKNOWN' THEN 2 ELSE 3 END))[1]`;
