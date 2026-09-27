import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DevicePolicy, OsPlatform, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommandsService } from '../devices/commands.service';
import { PaginationQueryDto, orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { QUEUE_COMPLIANCE } from '../queues/queues';
import { AssignPolicyDto, CreatePolicyDto, UpdatePolicyDto } from './policies.dto';
import { deviceScope } from '../common/scope';
import type { AuthUser } from '../common/types';
import type { AgentWorkforcePolicy } from '../workforce/ingest.service';

export type PolicySource = 'device' | 'workProfile' | 'department' | 'default';

export interface AgentPolicy {
  policyId: string;
  version: number;
  name: string;
  usb: {
    blockStorage: boolean;
    readOnly: boolean;
    allowWhitelisted: boolean;
    whitelist: { vendorId: string; productId: string; serialNumber: string; readOnly: boolean; expiresAt: string | null }[];
  };
  software: {
    blockUnauthorized: boolean;
    autoUninstallBlacklisted: boolean;
    blacklist: { name: string; publisher: string | null; matchType: string }[];
  };
  security: {
    requireAntivirus: boolean;
    requireEdr: boolean;
    requireFirewall: boolean;
    requireDiskEncryption: boolean;
    requireSecureBoot: boolean;
  };
  updates: { autoUpdateEnabled: boolean; autoPatchDeployment: boolean; patchDeadlineDays: number; maintenanceWindow: string | null };
  screenLock: { enabled: boolean; timeoutSec: number; requirePassword: boolean; screenSaver: boolean };
  checkinIntervalSec: number;
  inventoryIntervalSec: number;
  /** Workforce tracking settings (docs/WORKFORCE.md); added by the agent service. */
  workforce?: AgentWorkforcePolicy | null;
}

interface DeviceRef {
  id: string;
  policyId: string | null;
  departmentId: string | null;
  assignedUserId: string | null;
  platform: OsPlatform;
}

@Injectable()
export class PoliciesService {
  private defaultCache: { at: number; policy: DevicePolicy } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commands: CommandsService,
    @InjectQueue(QUEUE_COMPLIANCE) private readonly complianceQueue: Queue,
  ) {}

  async getDefault(): Promise<DevicePolicy> {
    if (this.defaultCache && Date.now() - this.defaultCache.at < 10_000) return this.defaultCache.policy;
    let p = await this.prisma.devicePolicy.findFirst({ where: { isDefault: true }, orderBy: { createdAt: 'asc' } });
    if (!p) {
      // Safety net: never run without a policy.
      p = await this.prisma.devicePolicy.upsert({
        where: { name: 'Corporate Baseline' },
        create: { name: 'Corporate Baseline', isDefault: true, description: 'Auto-created default policy' },
        update: { isDefault: true },
      });
    }
    this.defaultCache = { at: Date.now(), policy: p };
    return p;
  }

  /** device.policyId → department.policyId → default policy. */
  async resolveForDevice(device: {
    policyId: string | null;
    departmentId: string | null;
    assignedUserId?: string | null;
  }): Promise<{ policy: DevicePolicy; source: PolicySource }> {
    if (device.policyId) {
      const p = await this.prisma.devicePolicy.findUnique({ where: { id: device.policyId } });
      if (p) return { policy: p, source: 'device' };
    }
    // A device with no explicit policy inherits the policy of the assigned employee's
    // work profile (e.g. a Finance employee's device picks up the Finance policy).
    if (device.assignedUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: device.assignedUserId },
        select: { workProfile: { select: { policy: true } } },
      });
      if (u?.workProfile?.policy) return { policy: u.workProfile.policy, source: 'workProfile' };
    }
    if (device.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: device.departmentId }, include: { policy: true } });
      if (dept?.policy) return { policy: dept.policy, source: 'department' };
    }
    return { policy: await this.getDefault(), source: 'default' };
  }

  async effective(deviceId: string, user?: AuthUser) {
    const device = await this.prisma.device.findFirst({ where: { AND: [{ id: deviceId }, deviceScope(user)] } });
    if (!device) throw new NotFoundException('Device not found');
    const { policy, source } = await this.resolveForDevice(device);
    return { ...policy, source, agentPolicy: await this.buildAgentPolicy(device, policy) };
  }

  async buildAgentPolicy(device: DeviceRef, policy?: DevicePolicy): Promise<AgentPolicy> {
    const p = policy ?? (await this.resolveForDevice(device)).policy;
    const now = new Date();
    const scopeOr: Prisma.UsbDeviceWhereInput[] = [{ whitelistScope: 'GLOBAL' }, { whitelistScope: 'DEVICE', scopeRefId: device.id }];
    if (device.departmentId) scopeOr.push({ whitelistScope: 'DEPARTMENT', scopeRefId: device.departmentId });
    if (device.assignedUserId) scopeOr.push({ whitelistScope: 'USER', scopeRefId: device.assignedUserId });
    const [usb, temp, blacklist] = await Promise.all([
      this.prisma.usbDevice.findMany({ where: { isWhitelisted: true, OR: scopeOr }, take: 5000 }),
      this.prisma.usbAccessRequest.findMany({ where: { deviceId: device.id, status: 'APPROVED', expiresAt: { gt: now } } }),
      this.prisma.softwareBlacklist.findMany({ where: { OR: [{ platform: null }, { platform: device.platform }] } }),
    ]);
    return {
      policyId: p.id,
      version: p.version,
      name: p.name,
      usb: {
        blockStorage: p.usbStorageBlocked,
        readOnly: p.usbReadOnly,
        allowWhitelisted: p.allowWhitelistedUsb,
        whitelist: [
          ...usb.map((u) => ({ vendorId: u.vendorId, productId: u.productId, serialNumber: u.serialNumber, readOnly: u.readOnly, expiresAt: null })),
          ...temp.map((r) => ({
            vendorId: r.vendorId,
            productId: r.productId,
            serialNumber: r.serialNumber,
            readOnly: r.readOnly,
            expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          })),
        ],
      },
      software: {
        blockUnauthorized: p.blockUnauthorizedSoftware,
        autoUninstallBlacklisted: p.autoUninstallBlacklisted,
        blacklist: blacklist.map((b) => ({ name: b.name, publisher: b.publisher, matchType: b.matchType })),
      },
      security: {
        requireAntivirus: p.requireAntivirus,
        requireEdr: p.requireEdr,
        requireFirewall: p.requireFirewall,
        requireDiskEncryption: p.requireDiskEncryption,
        requireSecureBoot: p.requireSecureBoot,
      },
      updates: {
        autoUpdateEnabled: p.autoUpdateEnabled,
        autoPatchDeployment: p.autoPatchDeployment,
        patchDeadlineDays: p.patchDeadlineDays,
        maintenanceWindow: p.maintenanceWindow,
      },
      screenLock: {
        enabled: p.screenLockEnabled,
        timeoutSec: p.screenLockTimeoutSec,
        requirePassword: p.requirePasswordOnWake,
        screenSaver: p.screenSaverEnforced,
      },
      checkinIntervalSec: p.checkinIntervalSec,
      inventoryIntervalSec: p.inventoryIntervalSec,
    };
  }

  /** Where-clause for devices whose *effective* policy is `policy`. */
  affectedDevicesWhere(policy: DevicePolicy): Prisma.DeviceWhereInput {
    const or: Prisma.DeviceWhereInput[] = [
      { policyId: policy.id },
      { policyId: null, department: { policyId: policy.id } },
    ];
    if (policy.isDefault) {
      or.push({ policyId: null, departmentId: null }, { policyId: null, department: { policyId: null } });
    }
    return { status: { not: 'RETIRED' }, OR: or };
  }

  async list(q: PaginationQueryDto) {
    const where: Prisma.DevicePolicyWhereInput = q.search
      ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.devicePolicy.findMany({
        where,
        include: { _count: { select: { devices: true, departments: true } } },
        orderBy: orderBy({ sortBy: q.sortBy, sortOrder: q.sortBy ? q.sortOrder : 'asc' }, ['name', 'priority', 'createdAt', 'updatedAt'], 'priority'),
        ...skipTake(q),
      }),
      this.prisma.devicePolicy.count({ where }),
    ]);
    const data = await Promise.all(
      rows.map(async ({ _count, ...p }) => ({
        ...p,
        directDeviceCount: _count.devices,
        departmentCount: _count.departments,
        deviceCount: await this.prisma.device.count({ where: this.affectedDevicesWhere(p) }),
      })),
    );
    return paginated(data, q.page, q.pageSize, total);
  }

  async get(id: string) {
    const p = await this.prisma.devicePolicy.findUnique({
      where: { id },
      include: { departments: { select: { id: true, name: true } } },
    });
    if (!p) throw new NotFoundException('Policy not found');
    const deviceCount = await this.prisma.device.count({ where: this.affectedDevicesWhere(p) });
    return { ...p, deviceCount };
  }

  async create(dto: CreatePolicyDto, actor: AuthUser) {
    if (await this.prisma.devicePolicy.findUnique({ where: { name: dto.name } })) {
      throw new ConflictException('A policy with this name already exists');
    }
    const p = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.devicePolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.devicePolicy.create({
        data: { ...dto, extraSettings: (dto.extraSettings ?? {}) as Prisma.InputJsonValue, createdById: actor.id },
      });
    });
    this.defaultCache = null;
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'policy.create', resourceType: 'DevicePolicy', resourceId: p.id, after: p });
    if (dto.isDefault) await this.propagate(p, actor);
    return p;
  }

  async update(id: string, dto: UpdatePolicyDto, actor: AuthUser) {
    const before = await this.prisma.devicePolicy.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Policy not found');
    if (dto.name && dto.name !== before.name && (await this.prisma.devicePolicy.findUnique({ where: { name: dto.name } }))) {
      throw new ConflictException('A policy with this name already exists');
    }
    if (dto.isDefault === false && before.isDefault) {
      throw new UnprocessableEntityException('Set another policy as default instead of unsetting the default');
    }
    const p = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault && !before.isDefault) {
        await tx.devicePolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.devicePolicy.update({
        where: { id },
        data: {
          ...dto,
          extraSettings: dto.extraSettings === undefined ? undefined : (dto.extraSettings as Prisma.InputJsonValue),
          version: { increment: 1 },
        },
      });
    });
    this.defaultCache = null;
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'policy.update', resourceType: 'DevicePolicy', resourceId: id, before, after: p });
    const affected = await this.propagate(p, actor);
    return { ...p, affectedDevices: affected };
  }

  /**
   * Re-apply the *effective* policy to specific devices (e.g. after an employee's
   * work profile changes). Queues APPLY_POLICY for enrolled devices and re-evaluates
   * compliance for all of them.
   */
  async applyToDevices(deviceIds: string[], actor?: AuthUser): Promise<number> {
    if (!deviceIds.length) return 0;
    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds } },
      select: { id: true, status: true },
    });
    const enrolled = devices.filter((d) => d.status !== 'PENDING').map((d) => d.id);
    await this.commands.createMany(enrolled, 'APPLY_POLICY', {}, { createdById: actor?.id, dedupePending: true });
    await this.queueEvaluation(devices.map((d) => d.id));
    return devices.length;
  }

  /** Queue APPLY_POLICY for affected devices and re-evaluate their compliance. */
  async propagate(policy: DevicePolicy, actor?: AuthUser): Promise<number> {
    const devices = await this.prisma.device.findMany({
      where: { ...this.affectedDevicesWhere(policy) },
      select: { id: true, status: true },
    });
    const ids = devices.map((d) => d.id);
    const enrolled = devices.filter((d) => d.status !== 'PENDING').map((d) => d.id);
    await this.commands.createMany(enrolled, 'APPLY_POLICY', { version: policy.version }, { createdById: actor?.id, dedupePending: true });
    await this.queueEvaluation(ids);
    return ids.length;
  }

  async queueEvaluation(deviceIds: string[]): Promise<number> {
    if (!deviceIds.length) return 0;
    await this.complianceQueue.addBulk(
      deviceIds.map((deviceId) => ({
        name: 'evaluate',
        data: { deviceId },
        opts: { jobId: `eval-${deviceId}-${Math.floor(Date.now() / 5000)}`, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      })),
    );
    return deviceIds.length;
  }

  async remove(id: string) {
    const p = await this.prisma.devicePolicy.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Policy not found');
    if (p.isDefault) throw new UnprocessableEntityException('The default policy cannot be deleted');
    const affected = await this.prisma.device.findMany({ where: this.affectedDevicesWhere(p), select: { id: true } });
    await this.prisma.devicePolicy.delete({ where: { id } });
    await this.audit.log({ category: 'POLICY_CHANGE', action: 'policy.delete', resourceType: 'DevicePolicy', resourceId: id, before: p });
    const def = await this.getDefault();
    await this.commands.createMany(affected.map((d) => d.id), 'APPLY_POLICY', { version: def.version }, { dedupePending: true });
    await this.queueEvaluation(affected.map((d) => d.id));
  }

  async assign(id: string, dto: AssignPolicyDto, actor: AuthUser) {
    const p = await this.prisma.devicePolicy.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Policy not found');
    let devices = 0;
    let departments = 0;
    if (dto.deviceIds?.length) {
      devices = (await this.prisma.device.updateMany({ where: { id: { in: dto.deviceIds } }, data: { policyId: id } })).count;
    }
    if (dto.departmentIds?.length) {
      departments = (await this.prisma.department.updateMany({ where: { id: { in: dto.departmentIds } }, data: { policyId: id } })).count;
    }
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'policy.assign',
      resourceType: 'DevicePolicy',
      resourceId: id,
      after: { deviceIds: dto.deviceIds ?? [], departmentIds: dto.departmentIds ?? [] },
    });
    const affected = await this.propagate(p, actor);
    return { devices, departments, affectedDevices: affected };
  }

  async devices(id: string, q: PaginationQueryDto) {
    const p = await this.prisma.devicePolicy.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Policy not found');
    const where: Prisma.DeviceWhereInput = { AND: [this.affectedDevicesWhere(p)] };
    if (q.search) {
      (where.AND as Prisma.DeviceWhereInput[]).push({
        OR: [
          { deviceName: { contains: q.search, mode: 'insensitive' } },
          { serialNumber: { contains: q.search, mode: 'insensitive' } },
          { hostname: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }
    const [rows, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        select: {
          id: true, deviceName: true, hostname: true, serialNumber: true, platform: true, status: true,
          complianceState: true, complianceScore: true, riskLevel: true, policyId: true, departmentId: true,
          department: { select: { id: true, name: true, policyId: true } }, lastSeenAt: true,
        },
        orderBy: orderBy(q, ['deviceName', 'createdAt', 'complianceScore', 'lastSeenAt'], 'deviceName'),
        ...skipTake(q),
      }),
      this.prisma.device.count({ where }),
    ]);
    return paginated(
      rows.map(({ department, ...d }) => ({
        ...d,
        department: department ? { id: department.id, name: department.name } : null,
        policySource: d.policyId === id ? 'device' : department?.policyId === id ? 'department' : 'default',
      })),
      q.page,
      q.pageSize,
      total,
    );
  }
}
