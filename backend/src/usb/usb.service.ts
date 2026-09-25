import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, UsbAccessRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommandsService } from '../devices/commands.service';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { assertDeviceInScope, deviceScope, deviceScopeSql, isScoped, viaDevice } from '../common/scope';
import type { AuthUser } from '../common/types';
import {
  ApproveUsbRequestDto,
  CreateUsbRequestDto,
  CreateUsbWhitelistDto,
  UpdateUsbDeviceDto,
  UsbDeviceQueryDto,
  UsbEventQueryDto,
  UsbRequestQueryDto,
} from './usb.dto';

const REQUEST_INCLUDE = {
  device: { select: { id: true, deviceName: true, departmentId: true, assignedUserId: true } },
  requester: { select: { id: true, displayName: true, email: true } },
  approver: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.UsbAccessRequestInclude;

@Injectable()
export class UsbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commands: CommandsService,
  ) {}

  // ── Known devices / whitelist ──
  async listDevices(q: UsbDeviceQueryDto) {
    const where: Prisma.UsbDeviceWhereInput = {};
    if (q.isWhitelisted !== undefined) where.isWhitelisted = q.isWhitelisted;
    if (q.deviceClass) where.deviceClass = q.deviceClass;
    if (q.search) {
      where.OR = [
        { productName: { contains: q.search, mode: 'insensitive' } },
        { manufacturer: { contains: q.search, mode: 'insensitive' } },
        { vendorId: { contains: q.search, mode: 'insensitive' } },
        { productId: { contains: q.search, mode: 'insensitive' } },
        { serialNumber: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.usbDevice.findMany({
        where,
        include: { _count: { select: { events: true } } },
        orderBy: orderBy(q, ['lastSeenAt', 'firstSeenAt', 'productName', 'vendorId', 'approvedAt'], 'lastSeenAt'),
        ...skipTake(q),
      }),
      this.prisma.usbDevice.count({ where }),
    ]);
    return paginated(rows.map(({ _count, ...r }) => ({ ...r, eventCount: _count.events })), q.page, q.pageSize, total);
  }

  private async validateScope(scope: string, ref?: string | null) {
    if (scope === 'GLOBAL') return null;
    if (!ref) throw new BadRequestException(`scopeRefId is required for ${scope} scope`);
    const exists =
      scope === 'DEPARTMENT'
        ? await this.prisma.department.findUnique({ where: { id: ref } })
        : scope === 'USER'
          ? await this.prisma.user.findUnique({ where: { id: ref } })
          : await this.prisma.device.findUnique({ where: { id: ref } });
    if (!exists) throw new BadRequestException(`scopeRefId does not reference an existing ${scope.toLowerCase()}`);
    return ref;
  }

  /** Devices whose agent must refresh USB rules after a whitelist change. */
  private async devicesForScope(scope: string, ref: string | null): Promise<string[]> {
    const base: Prisma.DeviceWhereInput = { status: { in: ['ACTIVE', 'INACTIVE', 'QUARANTINED'] } };
    const where: Prisma.DeviceWhereInput =
      scope === 'DEPARTMENT' ? { ...base, departmentId: ref } : scope === 'USER' ? { ...base, assignedUserId: ref } : scope === 'DEVICE' ? { ...base, id: ref! } : base;
    return (await this.prisma.device.findMany({ where, select: { id: true } })).map((d) => d.id);
  }

  async addToWhitelist(dto: CreateUsbWhitelistDto, actor: AuthUser) {
    const scopeRefId = await this.validateScope(dto.whitelistScope, dto.scopeRefId);
    const key = { vendorId: dto.vendorId.toLowerCase(), productId: dto.productId.toLowerCase(), serialNumber: dto.serialNumber ?? '' };
    const existing = await this.prisma.usbDevice.findUnique({ where: { vendorId_productId_serialNumber: key } });
    if (existing?.isWhitelisted) throw new ConflictException('USB device is already whitelisted');
    const data = {
      productName: dto.productName ?? existing?.productName,
      manufacturer: dto.manufacturer ?? existing?.manufacturer,
      deviceClass: dto.deviceClass,
      isWhitelisted: true,
      whitelistScope: dto.whitelistScope,
      scopeRefId,
      readOnly: dto.readOnly ?? false,
      notes: dto.notes,
      approvedById: actor.id,
      approvedAt: new Date(),
    };
    const usb = existing
      ? await this.prisma.usbDevice.update({ where: { id: existing.id }, data })
      : await this.prisma.usbDevice.create({ data: { ...key, ...data } });
    await this.audit.log({ category: 'USB', action: 'usb.whitelist.add', resourceType: 'UsbDevice', resourceId: usb.id, before: existing ?? undefined, after: usb });
    await this.commands.createMany(await this.devicesForScope(usb.whitelistScope, usb.scopeRefId), 'REFRESH_USB_RULES', {}, { createdById: actor.id, dedupePending: true });
    return usb;
  }

  async updateDevice(id: string, dto: UpdateUsbDeviceDto, actor: AuthUser) {
    const before = await this.prisma.usbDevice.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('USB device not found');
    const scope = dto.whitelistScope ?? before.whitelistScope;
    const ref = dto.whitelistScope !== undefined || dto.scopeRefId !== undefined ? await this.validateScope(scope, dto.scopeRefId ?? before.scopeRefId) : before.scopeRefId;
    const data: Prisma.UsbDeviceUpdateInput = {
      ...(dto.productName !== undefined ? { productName: dto.productName } : {}),
      ...(dto.manufacturer !== undefined ? { manufacturer: dto.manufacturer } : {}),
      ...(dto.deviceClass !== undefined ? { deviceClass: dto.deviceClass } : {}),
      ...(dto.readOnly !== undefined ? { readOnly: dto.readOnly } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.isWhitelisted !== undefined ? { isWhitelisted: dto.isWhitelisted } : {}),
      whitelistScope: scope,
      scopeRefId: ref,
      ...(dto.isWhitelisted && !before.isWhitelisted ? { approvedById: actor.id, approvedAt: new Date() } : {}),
    };
    const usb = await this.prisma.usbDevice.update({ where: { id }, data });
    await this.audit.log({ category: 'USB', action: 'usb.device.update', resourceType: 'UsbDevice', resourceId: id, before, after: usb });
    const affected = new Set([
      ...(await this.devicesForScope(before.whitelistScope, before.scopeRefId)),
      ...(await this.devicesForScope(usb.whitelistScope, usb.scopeRefId)),
    ]);
    await this.commands.createMany([...affected], 'REFRESH_USB_RULES', {}, { createdById: actor.id, dedupePending: true });
    return usb;
  }

  async removeFromWhitelist(id: string, actor: AuthUser) {
    const before = await this.prisma.usbDevice.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('USB device not found');
    await this.prisma.usbDevice.update({ where: { id }, data: { isWhitelisted: false, approvedById: null, approvedAt: null } });
    await this.audit.log({ category: 'USB', action: 'usb.whitelist.remove', resourceType: 'UsbDevice', resourceId: id, before });
    await this.commands.createMany(await this.devicesForScope(before.whitelistScope, before.scopeRefId), 'REFRESH_USB_RULES', {}, { createdById: actor.id, dedupePending: true });
  }

  // ── Events ──
  async events(q: UsbEventQueryDto, user?: AuthUser) {
    const and: Prisma.UsbEventWhereInput[] = [isScoped(user) ? viaDevice(user) : {}];
    if (q.deviceId) and.push({ deviceId: q.deviceId });
    if (q.eventType) and.push({ eventType: q.eventType });
    if (q.vendorId) and.push({ vendorId: { equals: q.vendorId, mode: 'insensitive' } });
    if (q.from || q.to) and.push({ occurredAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } });
    if (q.search) {
      and.push({
        OR: [
          { label: { contains: q.search, mode: 'insensitive' } },
          { userName: { contains: q.search, mode: 'insensitive' } },
          { serialNumber: { contains: q.search, mode: 'insensitive' } },
          { device: { deviceName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.usbEvent.findMany({
        where,
        include: {
          device: { select: { id: true, deviceName: true } },
          usbDevice: { select: { id: true, productName: true, manufacturer: true, isWhitelisted: true } },
        },
        orderBy: orderBy(q, ['occurredAt', 'receivedAt', 'eventType'], 'occurredAt'),
        ...skipTake(q),
      }),
      this.prisma.usbEvent.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  // ── Temporary access requests ──
  private requestScope(user: AuthUser): Prisma.UsbAccessRequestWhereInput {
    if (user.roleKey === 'EMPLOYEE') return { OR: [{ requesterId: user.id }, { device: { assignedUserId: user.id } }] };
    if (user.roleKey === 'DEPARTMENT_MANAGER') return { device: deviceScope(user) };
    return {};
  }

  async listRequests(q: UsbRequestQueryDto, user: AuthUser) {
    const and: Prisma.UsbAccessRequestWhereInput[] = [this.requestScope(user)];
    if (q.status) and.push({ status: q.status });
    if (q.deviceId) and.push({ deviceId: q.deviceId });
    if (q.search) {
      and.push({
        OR: [
          { reason: { contains: q.search, mode: 'insensitive' } },
          { device: { deviceName: { contains: q.search, mode: 'insensitive' } } },
          { requester: { displayName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.usbAccessRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: orderBy(q, ['createdAt', 'decidedAt', 'expiresAt', 'status'], 'createdAt'),
        ...skipTake(q),
      }),
      this.prisma.usbAccessRequest.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async createRequest(dto: CreateUsbRequestDto, user: AuthUser) {
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    assertDeviceInScope(user, device);
    if (device.status === 'RETIRED') throw new UnprocessableEntityException('Device is retired');
    const serial = dto.serialNumber ?? '';
    const pending = await this.prisma.usbAccessRequest.findFirst({
      where: { deviceId: dto.deviceId, vendorId: dto.vendorId.toLowerCase(), productId: dto.productId.toLowerCase(), serialNumber: serial, status: 'PENDING' },
    });
    if (pending) throw new ConflictException('A pending request already exists for this USB device');
    const usb = await this.prisma.usbDevice.findUnique({
      where: { vendorId_productId_serialNumber: { vendorId: dto.vendorId.toLowerCase(), productId: dto.productId.toLowerCase(), serialNumber: serial } },
    });
    const req = await this.prisma.usbAccessRequest.create({
      data: {
        deviceId: dto.deviceId,
        usbDeviceId: usb?.id,
        vendorId: dto.vendorId.toLowerCase(),
        productId: dto.productId.toLowerCase(),
        serialNumber: serial,
        requesterId: user.id,
        reason: dto.reason,
        durationHours: dto.durationHours,
        readOnly: dto.readOnly ?? true,
      },
      include: REQUEST_INCLUDE,
    });
    await this.audit.log({ category: 'USB', action: 'usb.request.create', resourceType: 'UsbAccessRequest', resourceId: req.id, deviceId: dto.deviceId, after: dto });
    return req;
  }

  private async loadForDecision(id: string, user: AuthUser) {
    const req = await this.prisma.usbAccessRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!req) throw new NotFoundException('Request not found');
    assertDeviceInScope(user, req.device);
    return req;
  }

  async approve(id: string, dto: ApproveUsbRequestDto, user: AuthUser) {
    const req = await this.loadForDecision(id, user);
    if (req.status !== 'PENDING') throw new UnprocessableEntityException(`Request is already ${req.status}`);
    if (req.requesterId === user.id && user.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('You cannot approve your own request');
    }
    const hours = dto.durationHours ?? req.durationHours;
    const now = new Date();
    const updated = await this.prisma.usbAccessRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approverId: user.id,
        decisionNote: dto.note,
        decidedAt: now,
        durationHours: hours,
        expiresAt: new Date(now.getTime() + hours * 3_600_000),
      },
      include: REQUEST_INCLUDE,
    });
    await this.commands.create(req.deviceId, 'REFRESH_USB_RULES', {}, { createdById: user.id, audit: false });
    await this.audit.log({
      category: 'USB',
      action: 'usb.request.approve',
      resourceType: 'UsbAccessRequest',
      resourceId: id,
      deviceId: req.deviceId,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', expiresAt: updated.expiresAt, durationHours: hours, note: dto.note },
    });
    return updated;
  }

  async deny(id: string, note: string | undefined, user: AuthUser) {
    const req = await this.loadForDecision(id, user);
    if (req.status !== 'PENDING') throw new UnprocessableEntityException(`Request is already ${req.status}`);
    const updated = await this.prisma.usbAccessRequest.update({
      where: { id },
      data: { status: 'DENIED', approverId: user.id, decisionNote: note, decidedAt: new Date() },
      include: REQUEST_INCLUDE,
    });
    await this.audit.log({ category: 'USB', action: 'usb.request.deny', resourceType: 'UsbAccessRequest', resourceId: id, deviceId: req.deviceId, before: { status: 'PENDING' }, after: { status: 'DENIED', note } });
    return updated;
  }

  async revoke(id: string, user: AuthUser) {
    const req = await this.loadForDecision(id, user);
    if (!['APPROVED', 'PENDING'].includes(req.status)) throw new UnprocessableEntityException(`Request is already ${req.status}`);
    const updated = await this.prisma.usbAccessRequest.update({
      where: { id },
      data: { status: 'REVOKED', decidedAt: new Date(), approverId: req.approverId ?? user.id, expiresAt: new Date() },
      include: REQUEST_INCLUDE,
    });
    if (req.status === 'APPROVED') {
      await this.commands.create(req.deviceId, 'REFRESH_USB_RULES', {}, { createdById: user.id, audit: false });
    }
    await this.audit.log({ category: 'USB', action: 'usb.request.revoke', resourceType: 'UsbAccessRequest', resourceId: id, deviceId: req.deviceId, before: { status: req.status }, after: { status: 'REVOKED' } });
    return updated;
  }

  /** Expire approved temporary access (scheduler). */
  async expireRequests(): Promise<number> {
    const expired: UsbAccessRequest[] = await this.prisma.usbAccessRequest.findMany({
      where: { status: 'APPROVED', expiresAt: { lte: new Date() } },
    });
    if (!expired.length) return 0;
    await this.prisma.usbAccessRequest.updateMany({ where: { id: { in: expired.map((r) => r.id) } }, data: { status: 'EXPIRED' } });
    await this.commands.createMany([...new Set(expired.map((r) => r.deviceId))], 'REFRESH_USB_RULES', {}, { dedupePending: true });
    for (const r of expired) {
      await this.audit.log({
        category: 'USB',
        action: 'usb.request.expire',
        actorType: 'SYSTEM',
        actorId: null,
        actorName: 'scheduler',
        resourceType: 'UsbAccessRequest',
        resourceId: r.id,
        deviceId: r.deviceId,
        before: { status: 'APPROVED' },
        after: { status: 'EXPIRED' },
      });
    }
    return expired.length;
  }

  async stats(days: number, user?: AuthUser) {
    const now = Date.now();
    const since24 = new Date(now - 86_400_000);
    const since7 = new Date(now - 7 * 86_400_000);
    const sinceN = new Date(now - days * 86_400_000);
    const scope = isScoped(user) ? viaDevice(user) : {};
    const scopeSql = deviceScopeSql(user, 'd');
    const [blocked24h, blocked7d, allowed7d, top, byDay] = await Promise.all([
      this.prisma.usbEvent.count({ where: { ...scope, eventType: 'BLOCKED', occurredAt: { gte: since24 } } }),
      this.prisma.usbEvent.count({ where: { ...scope, eventType: 'BLOCKED', occurredAt: { gte: since7 } } }),
      this.prisma.usbEvent.count({ where: { ...scope, eventType: 'ALLOWED', occurredAt: { gte: since7 } } }),
      this.prisma.$queryRaw<{ deviceId: string; deviceName: string; blocked: bigint }[]>`
        SELECT e.device_id AS "deviceId", d.device_name AS "deviceName", count(*)::bigint AS blocked
        FROM usb_events e JOIN devices d ON d.id = e.device_id
        WHERE e.event_type = 'BLOCKED' AND e.occurred_at >= ${since7} AND ${scopeSql}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
      this.prisma.$queryRaw<{ date: string; blocked: bigint; allowed: bigint }[]>`
        SELECT to_char(date_trunc('day', e.occurred_at), 'YYYY-MM-DD') AS date,
               count(*) FILTER (WHERE e.event_type = 'BLOCKED')::bigint AS blocked,
               count(*) FILTER (WHERE e.event_type = 'ALLOWED')::bigint AS allowed
        FROM usb_events e JOIN devices d ON d.id = e.device_id
        WHERE e.occurred_at >= ${sinceN} AND ${scopeSql}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const map = new Map(byDay.map((r) => [r.date, r]));
    const days_: { date: string; blocked: number; allowed: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * 86_400_000).toISOString().substring(0, 10);
      const r = map.get(date);
      days_.push({ date, blocked: Number(r?.blocked ?? 0), allowed: Number(r?.allowed ?? 0) });
    }
    return {
      blocked24h,
      blocked7d,
      allowed7d,
      topDevices: top.map((t) => ({ deviceId: t.deviceId, deviceName: t.deviceName, blocked: Number(t.blocked) })),
      byDay: days_,
    };
  }
}
