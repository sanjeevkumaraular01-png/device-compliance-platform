import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PoliciesService } from '../policies/policies.service';
import { PaginationQueryDto, paginated, skipTake, orderBy } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { AssignWorkProfileDto, CreateWorkProfileDto, UpdateWorkProfileDto } from './work-profiles.dto';

const WITH_POLICY = {
  policy: { select: { id: true, name: true, version: true } },
  _count: { select: { users: true } },
} satisfies Prisma.WorkProfileInclude;

@Injectable()
export class WorkProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policies: PoliciesService,
  ) {}

  async list(q: PaginationQueryDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.workProfile.findMany({
        ...skipTake(q),
        orderBy: orderBy(q, ['name', 'key', 'createdAt'], 'name'),
        include: WITH_POLICY,
      }),
      this.prisma.workProfile.count(),
    ]);
    return paginated(data, q.page, q.pageSize, total);
  }

  async get(id: string) {
    const wp = await this.prisma.workProfile.findUnique({ where: { id }, include: WITH_POLICY });
    if (!wp) throw new NotFoundException('Work profile not found');
    return wp;
  }

  async create(dto: CreateWorkProfileDto, actor: AuthUser) {
    await this.assertNameFree(dto.name);
    if (dto.policyId) await this.assertPolicyExists(dto.policyId);
    const wp = await this.prisma.workProfile.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        policyId: dto.policyId ?? null,
        requiredSoftware: dto.requiredSoftware ?? [],
        prohibitedSoftware: dto.prohibitedSoftware ?? [],
        createdById: actor.id,
      },
      include: WITH_POLICY,
    });
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'work_profile.create',
      resourceType: 'WorkProfile',
      resourceId: wp.id,
      after: wp,
    });
    return wp;
  }

  async update(id: string, dto: UpdateWorkProfileDto, actor: AuthUser) {
    const before = await this.get(id);
    if (dto.name && dto.name !== before.name) await this.assertNameFree(dto.name);
    if (dto.policyId) await this.assertPolicyExists(dto.policyId);
    const wp = await this.prisma.workProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.policyId !== undefined ? { policyId: dto.policyId } : {}),
        ...(dto.requiredSoftware !== undefined ? { requiredSoftware: dto.requiredSoftware } : {}),
        ...(dto.prohibitedSoftware !== undefined ? { prohibitedSoftware: dto.prohibitedSoftware } : {}),
      },
      include: WITH_POLICY,
    });
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'work_profile.update',
      resourceType: 'WorkProfile',
      resourceId: id,
      before,
      after: wp,
    });
    // If the mapped policy changed, re-apply the effective policy to affected devices.
    if (dto.policyId !== undefined && dto.policyId !== before.policyId) {
      await this.applyToProfileDevices(id, actor);
    }
    return wp;
  }

  async remove(id: string) {
    const wp = await this.get(id);
    // Users keep working; their work_profile_id is set null by the FK. Devices fall back
    // to department/default policy on next evaluation.
    await this.prisma.workProfile.delete({ where: { id } });
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'work_profile.delete',
      resourceType: 'WorkProfile',
      resourceId: id,
      before: wp,
    });
  }

  async assignUsers(id: string, dto: AssignWorkProfileDto, actor: AuthUser) {
    await this.get(id);
    const res = await this.prisma.user.updateMany({ where: { id: { in: dto.userIds } }, data: { workProfileId: id } });
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'work_profile.assign',
      resourceType: 'WorkProfile',
      resourceId: id,
      metadata: { userIds: dto.userIds, updated: res.count },
    });
    const applied = await this.applyToUsersDevices(dto.userIds, actor);
    return { assigned: res.count, devicesUpdated: applied };
  }

  /** Devices whose assigned employee is on this profile → re-apply effective policy. */
  private async applyToProfileDevices(profileId: string, actor: AuthUser) {
    const users = await this.prisma.user.findMany({ where: { workProfileId: profileId }, select: { id: true } });
    return this.applyToUsersDevices(users.map((u) => u.id), actor);
  }

  private async applyToUsersDevices(userIds: string[], actor: AuthUser) {
    if (!userIds.length) return 0;
    const devices = await this.prisma.device.findMany({
      where: { assignedUserId: { in: userIds } },
      select: { id: true },
    });
    return this.policies.applyToDevices(devices.map((d) => d.id), actor);
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.workProfile.findUnique({ where: { name } });
    if (existing) throw new ConflictException('A work profile with this name already exists');
  }

  private async assertPolicyExists(policyId: string) {
    const p = await this.prisma.devicePolicy.findUnique({ where: { id: policyId }, select: { id: true } });
    if (!p) throw new NotFoundException('Device policy not found');
  }
}
