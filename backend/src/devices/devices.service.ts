import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Device, Prisma, WarrantyStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PoliciesService } from '../policies/policies.service';
import { CommandsService } from './commands.service';
import { orderBy, paginated, skipTake, PaginationQueryDto } from '../common/dto/pagination.dto';
import { deviceScope, isScoped } from '../common/scope';
import type { AuthUser } from '../common/types';
import {
  CreateCommandDto,
  CreateDeviceDto,
  DevicePatchQueryDto,
  DeviceQueryDto,
  DeviceSoftwareQueryDto,
  DeviceUsbEventQueryDto,
  TimelineQueryDto,
  UpdateDeviceDto,
} from './devices.dto';

export const ONLINE_WINDOW_MS = 15 * 60_000;

export const DEVICE_INCLUDE = {
  assignedUser: { select: { id: true, displayName: true, email: true } },
  department: { select: { id: true, name: true } },
  policy: { select: { id: true, name: true } },
  group: { select: { id: true, name: true, color: true } },
} satisfies Prisma.DeviceInclude;

type DeviceWithRefs = Prisma.DeviceGetPayload<{ include: typeof DEVICE_INCLUDE }>;

export function serializeDevice(d: DeviceWithRefs | (Device & Partial<DeviceWithRefs>)) {
  const { agentTokenHash: _hash, ...rest } = d as Device & Partial<DeviceWithRefs>;
  return {
    ...rest,
    assignedUser: rest.assignedUser ?? null,
    department: rest.department ?? null,
    policy: rest.policy ?? null,
    group: rest.group ?? null,
    online: !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() <= ONLINE_WINDOW_MS,
  };
}

export function computeWarrantyStatus(expires: Date | null | undefined, now = new Date()): WarrantyStatus {
  if (!expires) return 'UNKNOWN';
  const diff = new Date(expires).getTime() - now.getTime();
  if (diff < 0) return 'EXPIRED';
  if (diff <= 60 * 86_400_000) return 'EXPIRING';
  return 'ACTIVE';
}

export function generateAssetId(): string {
  return `SEM-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    private readonly compliance: ComplianceService,
    private readonly policies: PoliciesService,
    private readonly commands: CommandsService,
  ) {}

  /** Load a device visible to the user or throw 404. */
  async findScoped(id: string, user?: AuthUser): Promise<DeviceWithRefs> {
    const d = await this.prisma.device.findFirst({
      where: { AND: [{ id }, deviceScope(user)] },
      include: DEVICE_INCLUDE,
    });
    if (!d) throw new NotFoundException('Device not found');
    return d;
  }

  buildWhere(q: DeviceQueryDto, user?: AuthUser): Prisma.DeviceWhereInput {
    const and: Prisma.DeviceWhereInput[] = [deviceScope(user)];
    if (q.status) and.push({ status: q.status });
    else and.push({ status: { not: 'RETIRED' } });
    if (q.platform) and.push({ platform: q.platform });
    if (q.complianceState) and.push({ complianceState: q.complianceState });
    if (q.riskLevel) and.push({ riskLevel: q.riskLevel });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId });
    if (q.policyId) and.push({ policyId: q.policyId });
    if (q.groupId) and.push({ groupId: q.groupId });
    if (q.deviceType) and.push({ deviceType: q.deviceType });
    if (q.warrantyStatus) and.push({ warrantyStatus: q.warrantyStatus });
    if (q.online !== undefined) {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS);
      and.push(q.online ? { lastSeenAt: { gte: since } } : { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: since } }] });
    }
    if (q.search) {
      const s = q.search;
      and.push({
        OR: [
          { deviceName: { contains: s, mode: 'insensitive' } },
          { hostname: { contains: s, mode: 'insensitive' } },
          { serialNumber: { contains: s, mode: 'insensitive' } },
          { assetId: { contains: s, mode: 'insensitive' } },
          { model: { contains: s, mode: 'insensitive' } },
          { ipAddress: { contains: s, mode: 'insensitive' } },
          { assignedUser: { displayName: { contains: s, mode: 'insensitive' } } },
          { assignedUser: { email: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    return { AND: and };
  }

  async list(q: DeviceQueryDto, user?: AuthUser) {
    const where = this.buildWhere(q, user);
    const [rows, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: DEVICE_INCLUDE,
        orderBy: orderBy(
          q,
          ['createdAt', 'updatedAt', 'deviceName', 'hostname', 'serialNumber', 'assetId', 'platform', 'complianceScore',
            'complianceState', 'riskLevel', 'lastSeenAt', 'enrolledAt', 'status', 'warrantyExpiresAt', 'lastEvaluatedAt'],
          'createdAt',
        ),
        ...skipTake(q),
      }),
      this.prisma.device.count({ where }),
    ]);
    return paginated(rows.map(serializeDevice), q.page, q.pageSize, total);
  }

  async detail(id: string, user?: AuthUser) {
    const d = await this.findScoped(id, user);
    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const [securityStatus, latestCompliance, software, unauthorizedSoftware, missingPatches, usbBlocked7d, openAlerts] =
      await Promise.all([
        this.prisma.securityStatus.findUnique({ where: { deviceId: id } }),
        this.prisma.complianceResult.findFirst({ where: { deviceId: id }, orderBy: { evaluatedAt: 'desc' } }),
        this.prisma.softwareInventory.count({ where: { deviceId: id, removedAt: null } }),
        this.prisma.softwareInventory.count({ where: { deviceId: id, removedAt: null, status: { in: ['UNAUTHORIZED', 'BLACKLISTED'] } } }),
        this.prisma.patchStatus.count({ where: { deviceId: id, state: { in: ['MISSING', 'FAILED'] } } }),
        this.prisma.usbEvent.count({ where: { deviceId: id, eventType: 'BLOCKED', occurredAt: { gte: since7d } } }),
        this.prisma.alert.count({ where: { deviceId: id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),
      ]);
    return {
      ...serializeDevice(d),
      securityStatus,
      latestCompliance,
      counts: { software, unauthorizedSoftware, missingPatches, usbBlocked7d, openAlerts },
    };
  }

  private async assertRefs(dto: { departmentId?: string | null; assignedUserId?: string | null; policyId?: string | null }) {
    if (dto.departmentId && !(await this.prisma.department.findUnique({ where: { id: dto.departmentId } }))) {
      throw new BadRequestException('departmentId does not exist');
    }
    if (dto.assignedUserId && !(await this.prisma.user.findUnique({ where: { id: dto.assignedUserId } }))) {
      throw new BadRequestException('assignedUserId does not exist');
    }
    if (dto.policyId && !(await this.prisma.devicePolicy.findUnique({ where: { id: dto.policyId } }))) {
      throw new BadRequestException('policyId does not exist');
    }
  }

  async create(dto: CreateDeviceDto, actor: AuthUser) {
    await this.assertRefs(dto);
    if (await this.prisma.device.findUnique({ where: { serialNumber: dto.serialNumber } })) {
      throw new ConflictException('A device with this serial number already exists');
    }
    const assetId = dto.assetId || generateAssetId();
    if (await this.prisma.device.findUnique({ where: { assetId } })) throw new ConflictException('assetId already in use');
    const d = await this.prisma.device.create({
      data: {
        ...dto,
        assetId,
        tags: dto.tags ?? [],
        status: 'PENDING',
        warrantyStatus: computeWarrantyStatus(dto.warrantyExpiresAt),
        ...(dto.assignedUserId
          ? { assignments: { create: { userId: dto.assignedUserId, assignedById: actor.id, notes: 'Initial assignment' } } }
          : {}),
      },
      include: DEVICE_INCLUDE,
    });
    const out = serializeDevice(d);
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device.create', resourceType: 'Device', resourceId: d.id, deviceId: d.id, after: out });
    return out;
  }

  async update(id: string, dto: UpdateDeviceDto, actor: AuthUser) {
    const before = await this.findScoped(id, actor);
    await this.assertRefs(dto);
    if (dto.serialNumber && dto.serialNumber !== before.serialNumber) {
      if (await this.prisma.device.findUnique({ where: { serialNumber: dto.serialNumber } })) {
        throw new ConflictException('A device with this serial number already exists');
      }
    }
    if (dto.assetId && dto.assetId !== before.assetId) {
      if (await this.prisma.device.findUnique({ where: { assetId: dto.assetId } })) throw new ConflictException('assetId already in use');
    }
    if (dto.status && !['ACTIVE', 'INACTIVE'].includes(dto.status)) {
      throw new UnprocessableEntityException('Use the quarantine/retire/approve endpoints to change status to ' + dto.status);
    }
    const { assignedUserId, ...rest } = dto;
    const data: Prisma.DeviceUncheckedUpdateInput = { ...rest };
    if (dto.warrantyExpiresAt !== undefined) data.warrantyStatus = computeWarrantyStatus(dto.warrantyExpiresAt);
    const d = await this.prisma.device.update({ where: { id }, data, include: DEVICE_INCLUDE });
    if (assignedUserId !== undefined && assignedUserId !== before.assignedUserId) {
      if (assignedUserId) await this.assign(id, assignedUserId, actor, 'Assigned via device update');
      else await this.unassign(id, actor);
    }
    const after = serializeDevice(await this.findScoped(id));
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.update',
      resourceType: 'Device',
      resourceId: id,
      deviceId: id,
      before: serializeDevice(before),
      after,
    });
    const policyAffecting = ['departmentId', 'policyId', 'isCompanyOwned'].some(
      (k) => (dto as Record<string, unknown>)[k] !== undefined && (dto as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k],
    );
    if (policyAffecting && d.status !== 'PENDING') {
      const { policy } = await this.policies.resolveForDevice(d);
      await this.commands.create(id, 'APPLY_POLICY', { version: policy.version }, { createdById: actor.id });
      await this.compliance.evaluateDevice(id);
    }
    return after;
  }

  async retire(id: string, hard: boolean, actor: AuthUser) {
    const before = await this.findScoped(id, actor);
    if (hard) {
      if (actor.roleKey !== 'SUPER_ADMIN') throw new ForbiddenException('Only a Super Admin can permanently delete devices');
      await this.prisma.device.delete({ where: { id } });
      await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device.delete', resourceType: 'Device', resourceId: id, deviceId: null, before: serializeDevice(before), metadata: { deviceId: id } });
      return;
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id }, data: { status: 'RETIRED', agentTokenHash: null } }),
      this.prisma.deviceCertificate.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.deviceCommand.updateMany({ where: { deviceId: id, status: { in: ['PENDING', 'SENT'] } }, data: { status: 'CANCELLED', completedAt: now } }),
      this.prisma.deviceAssignment.updateMany({ where: { deviceId: id, unassignedAt: null }, data: { unassignedAt: now } }),
      this.prisma.alert.updateMany({ where: { deviceId: id, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: actor.id } }),
    ]);
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.retire',
      resourceType: 'Device',
      resourceId: id,
      deviceId: id,
      before: { status: before.status },
      after: { status: 'RETIRED', agentTokenRevoked: true, certificatesRevoked: true },
    });
  }

  async assign(id: string, userId: string, actor: AuthUser, notes?: string) {
    const device = await this.findScoped(id, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) throw new UnprocessableEntityException('Cannot assign a device to an inactive user');
    const now = new Date();
    const assignment = await this.prisma.$transaction(async (tx) => {
      await tx.deviceAssignment.updateMany({ where: { deviceId: id, unassignedAt: null }, data: { unassignedAt: now } });
      const a = await tx.deviceAssignment.create({
        data: { deviceId: id, userId, assignedById: actor.id, notes },
        include: { user: { select: { id: true, displayName: true, email: true } }, assignedBy: { select: { id: true, displayName: true, email: true } } },
      });
      await tx.device.update({
        where: { id },
        data: { assignedUserId: userId, ...(device.departmentId ? {} : user.departmentId ? { departmentId: user.departmentId } : {}) },
      });
      return a;
    });
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.assign',
      resourceType: 'Device',
      resourceId: id,
      deviceId: id,
      before: { assignedUserId: device.assignedUserId },
      after: { assignedUserId: userId, notes },
    });
    // The newly assigned employee's work profile may map to a different policy — re-apply.
    await this.policies.applyToDevices([id], actor);
    return assignment;
  }

  async unassign(id: string, actor: AuthUser, notes?: string) {
    const device = await this.findScoped(id, actor);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.deviceAssignment.updateMany({
        where: { deviceId: id, unassignedAt: null },
        data: { unassignedAt: now, ...(notes ? { notes } : {}) },
      }),
      this.prisma.device.update({ where: { id }, data: { assignedUserId: null } }),
    ]);
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.unassign',
      resourceType: 'Device',
      resourceId: id,
      deviceId: id,
      before: { assignedUserId: device.assignedUserId },
      after: { assignedUserId: null },
    });
    return serializeDevice(await this.findScoped(id));
  }

  async assignments(id: string, user?: AuthUser) {
    await this.findScoped(id, user);
    return this.prisma.deviceAssignment.findMany({
      where: { deviceId: id },
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        assignedBy: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async services(id: string, q: PaginationQueryDto, user?: AuthUser) {
    await this.findScoped(id, user);
    const where: Prisma.DeviceServiceWhereInput = { deviceId: id };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { displayName: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.deviceService.findMany({
        where,
        orderBy: orderBy(q, ['name', 'displayName', 'status', 'startType', 'lastSeenAt'], 'name'),
        ...skipTake(q),
      }),
      this.prisma.deviceService.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async software(id: string, q: DeviceSoftwareQueryDto, user?: AuthUser) {
    await this.findScoped(id, user);
    const where: Prisma.SoftwareInventoryWhereInput = { deviceId: id };
    if (!q.includeRemoved) where.removedAt = null;
    if (q.status) where.status = q.status;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { publisher: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.softwareInventory.findMany({
        where,
        orderBy: orderBy({ sortBy: q.sortBy, sortOrder: q.sortBy ? q.sortOrder : 'asc' }, ['name', 'version', 'publisher', 'installDate', 'status', 'firstSeenAt', 'lastSeenAt'], 'name'),
        ...skipTake(q),
      }),
      this.prisma.softwareInventory.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async patches(id: string, q: DevicePatchQueryDto, user?: AuthUser) {
    await this.findScoped(id, user);
    const where: Prisma.PatchStatusWhereInput = { deviceId: id };
    if (q.state) where.state = q.state;
    if (q.severity) where.severity = q.severity;
    if (q.search) {
      where.OR = [
        { patchId: { contains: q.search, mode: 'insensitive' } },
        { title: { contains: q.search, mode: 'insensitive' } },
        { cveIds: { has: q.search.toUpperCase() } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.patchStatus.findMany({
        where,
        orderBy: orderBy(q, ['releasedAt', 'detectedAt', 'severity', 'state', 'patchId', 'cvssScore', 'updatedAt'], 'releasedAt'),
        ...skipTake(q),
      }),
      this.prisma.patchStatus.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async usbEvents(id: string, q: DeviceUsbEventQueryDto, user?: AuthUser) {
    await this.findScoped(id, user);
    const where: Prisma.UsbEventWhereInput = { deviceId: id };
    if (q.eventType) where.eventType = q.eventType;
    if (q.search) {
      where.OR = [
        { label: { contains: q.search, mode: 'insensitive' } },
        { vendorId: { contains: q.search, mode: 'insensitive' } },
        { serialNumber: { contains: q.search, mode: 'insensitive' } },
        { userName: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.usbEvent.findMany({
        where,
        orderBy: orderBy(q, ['occurredAt', 'receivedAt', 'eventType'], 'occurredAt'),
        ...skipTake(q),
      }),
      this.prisma.usbEvent.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async complianceResults(id: string, user?: AuthUser) {
    await this.findScoped(id, user);
    return this.prisma.complianceResult.findMany({ where: { deviceId: id }, orderBy: { evaluatedAt: 'desc' }, take: 50 });
  }

  async security(id: string, user?: AuthUser) {
    await this.findScoped(id, user);
    const s = await this.prisma.securityStatus.findUnique({ where: { deviceId: id } });
    if (!s) throw new NotFoundException('No security status reported yet');
    return s;
  }

  async timeline(id: string, q: TimelineQueryDto, user?: AuthUser) {
    await this.findScoped(id, user);
    const where: Prisma.AuditLogWhereInput = {
      OR: [{ deviceId: id }, { resourceType: 'Device', resourceId: id }],
      ...(q.days ? { occurredAt: { gte: new Date(Date.now() - q.days * 86_400_000) } } : {}),
      ...(q.search ? { action: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, ...skipTake(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(rows.map((r) => ({ ...r, id: r.id.toString() })), q.page, q.pageSize, total);
  }

  async createCommand(id: string, dto: CreateCommandDto, actor: AuthUser) {
    const d = await this.findScoped(id, actor);
    if (d.status === 'RETIRED') throw new UnprocessableEntityException('Device is retired');
    if (d.status === 'PENDING') throw new UnprocessableEntityException('Device has not been approved yet');
    const payload = dto.payload ?? {};
    if (dto.type === 'UNINSTALL_SOFTWARE' && typeof payload.name !== 'string') {
      throw new BadRequestException('UNINSTALL_SOFTWARE requires payload.name');
    }
    if (dto.type === 'RESTART' && payload.delaySec === undefined) payload.delaySec = 60;
    if (dto.type === 'INSTALL_PATCHES' && payload.reboot === undefined) payload.reboot = 'if-required';
    if (dto.type === 'APPLY_POLICY' && payload.version === undefined) {
      payload.version = (await this.policies.resolveForDevice(d)).policy.version;
    }
    return this.commands.create(id, dto.type, payload, { createdById: actor.id });
  }

  async listCommands(id: string, user?: AuthUser) {
    await this.findScoped(id, user);
    return this.commands.list(id);
  }

  async quarantine(id: string, actor: AuthUser, reason?: string) {
    const d = await this.findScoped(id, actor);
    if (d.status === 'RETIRED') throw new UnprocessableEntityException('Device is retired');
    if (d.status === 'QUARANTINED') return serializeDevice(d);
    await this.prisma.device.update({ where: { id }, data: { status: 'QUARANTINED' } });
    await this.commands.create(id, 'LOCK_SCREEN', {}, { createdById: actor.id, audit: false });
    await this.alerts.raise({
      deviceId: id,
      category: 'DEVICE',
      severity: 'HIGH',
      title: `Device quarantined: ${d.deviceName}`,
      message: reason ? `Quarantined by ${actor.email}: ${reason}` : `Quarantined by ${actor.email}`,
      dedupeKey: `device:quarantine:${id}`,
    });
    await this.audit.log({
      category: 'SECURITY',
      action: 'device.quarantine',
      resourceType: 'Device',
      resourceId: id,
      deviceId: id,
      before: { status: d.status },
      after: { status: 'QUARANTINED', reason },
    });
    return serializeDevice(await this.findScoped(id));
  }

  async release(id: string, actor: AuthUser) {
    const d = await this.findScoped(id, actor);
    if (d.status !== 'QUARANTINED') throw new UnprocessableEntityException('Device is not quarantined');
    await this.prisma.device.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.alerts.autoResolve(`device:quarantine:${id}`, 'released');
    await this.audit.log({
      category: 'SECURITY',
      action: 'device.release',
      resourceType: 'Device',
      resourceId: id,
      deviceId: id,
      before: { status: 'QUARANTINED' },
      after: { status: 'ACTIVE' },
    });
    return serializeDevice(await this.findScoped(id));
  }

  async evaluate(id: string, user?: AuthUser) {
    await this.findScoped(id, user);
    return this.compliance.evaluateDevice(id);
  }

  /** For report/employee helpers. */
  scopeWhere(user?: AuthUser) {
    return isScoped(user) ? deviceScope(user) : {};
  }
}
