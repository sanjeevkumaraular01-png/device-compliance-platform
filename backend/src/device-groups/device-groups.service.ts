import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaginationQueryDto, paginated, skipTake, orderBy } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { CreateDeviceGroupDto, GroupMembersDto, UpdateDeviceGroupDto } from './device-groups.dto';

@Injectable()
export class DeviceGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: PaginationQueryDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.deviceGroup.findMany({
        ...skipTake(q),
        orderBy: orderBy(q, ['name', 'createdAt'], 'name'),
        include: { _count: { select: { devices: true } } },
      }),
      this.prisma.deviceGroup.count(),
    ]);
    return paginated(data, q.page, q.pageSize, total);
  }

  async get(id: string) {
    const g = await this.prisma.deviceGroup.findUnique({ where: { id }, include: { _count: { select: { devices: true } } } });
    if (!g) throw new NotFoundException('Device group not found');
    return g;
  }

  async create(dto: CreateDeviceGroupDto, actor: AuthUser) {
    await this.assertNameFree(dto.name);
    const g = await this.prisma.deviceGroup.create({
      data: { name: dto.name, description: dto.description ?? null, color: dto.color ?? null, createdById: actor.id },
      include: { _count: { select: { devices: true } } },
    });
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device_group.create', resourceType: 'DeviceGroup', resourceId: g.id, after: g });
    return g;
  }

  async update(id: string, dto: UpdateDeviceGroupDto, actor: AuthUser) {
    const before = await this.get(id);
    if (dto.name && dto.name !== before.name) await this.assertNameFree(dto.name);
    const g = await this.prisma.deviceGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
      include: { _count: { select: { devices: true } } },
    });
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device_group.update', resourceType: 'DeviceGroup', resourceId: id, before, after: g });
    return g;
  }

  async remove(id: string) {
    const g = await this.get(id);
    // Devices keep working; their group_id is set null by the FK.
    await this.prisma.deviceGroup.delete({ where: { id } });
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device_group.delete', resourceType: 'DeviceGroup', resourceId: id, before: g });
  }

  async addDevices(id: string, dto: GroupMembersDto, actor: AuthUser) {
    await this.get(id);
    const res = await this.prisma.device.updateMany({ where: { id: { in: dto.deviceIds } }, data: { groupId: id } });
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device_group.add_devices',
      resourceType: 'DeviceGroup',
      resourceId: id,
      metadata: { deviceIds: dto.deviceIds, added: res.count, by: actor.id },
    });
    return { added: res.count };
  }

  async removeDevices(id: string, dto: GroupMembersDto, actor: AuthUser) {
    await this.get(id);
    const res = await this.prisma.device.updateMany({ where: { id: { in: dto.deviceIds }, groupId: id }, data: { groupId: null } });
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device_group.remove_devices',
      resourceType: 'DeviceGroup',
      resourceId: id,
      metadata: { deviceIds: dto.deviceIds, removed: res.count, by: actor.id },
    });
    return { removed: res.count };
  }

  private async assertNameFree(name: string) {
    if (await this.prisma.deviceGroup.findUnique({ where: { name } })) {
      throw new ConflictException('A device group with this name already exists');
    }
  }
}
