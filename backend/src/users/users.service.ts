import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContextService } from '../auth/auth-context.service';
import { PoliciesService } from '../policies/policies.service';
import { hashPassword, passwordPolicyViolations } from '../auth/password.util';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { userScope } from '../common/scope';
import type { AuthUser } from '../common/types';
import { CreateUserDto, ImportUsersDto, UpdateUserDto, UserQueryDto } from './users.dto';

const PRIVILEGED = ['SUPER_ADMIN'];

export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  displayName: true,
  authProvider: true,
  externalId: true,
  roleId: true,
  departmentId: true,
  jobTitle: true,
  phone: true,
  employeeCode: true,
  location: true,
  workProfileId: true,
  managerId: true,
  isActive: true,
  mfaEnabled: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  lastLoginIp: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, key: true, name: true } },
  department: { select: { id: true, name: true } },
  workProfile: { select: { id: true, key: true, name: true } },
  manager: { select: { id: true, displayName: true, email: true } },
  _count: { select: { assignedDevices: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authCtx: AuthContextService,
    private readonly policies: PoliciesService,
  ) {}

  /** Re-apply the effective device policy to a user's assigned devices. */
  private async reapplyPolicyForUser(userId: string, actor: AuthUser) {
    const devices = await this.prisma.device.findMany({ where: { assignedUserId: userId }, select: { id: true } });
    await this.policies.applyToDevices(devices.map((d) => d.id), actor);
  }

  private serialize(u: Prisma.UserGetPayload<{ select: typeof USER_PUBLIC_SELECT }>) {
    const { _count, ...rest } = u;
    return { ...rest, roleKey: u.role.key, deviceCount: _count.assignedDevices };
  }

  async list(q: UserQueryDto, actor: AuthUser) {
    const where: Prisma.UserWhereInput = { AND: [userScope(actor)] };
    const and = where.AND as Prisma.UserWhereInput[];
    if (q.roleKey) and.push({ role: { key: q.roleKey } });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.isActive !== undefined) and.push({ isActive: q.isActive });
    if (q.search) {
      and.push({
        OR: [
          { email: { contains: q.search, mode: 'insensitive' } },
          { displayName: { contains: q.search, mode: 'insensitive' } },
          { jobTitle: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: orderBy(q, ['createdAt', 'email', 'displayName', 'lastLoginAt', 'updatedAt'], 'createdAt'),
        ...skipTake(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map((r) => this.serialize(r)), q.page, q.pageSize, total);
  }

  async get(id: string, actor: AuthUser) {
    const u = await this.prisma.user.findFirst({ where: { AND: [{ id }, userScope(actor)] }, select: USER_PUBLIC_SELECT });
    if (!u) throw new NotFoundException('User not found');
    return this.serialize(u);
  }

  private async resolveRole(roleKey: string, actor: AuthUser) {
    if (PRIVILEGED.includes(roleKey) && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }
    const role = await this.prisma.role.findUnique({ where: { key: roleKey as never } });
    if (!role) throw new BadRequestException(`Unknown role ${roleKey}`);
    return role;
  }

  private checkPassword(password: string) {
    const v = passwordPolicyViolations(password);
    if (v.length) throw new BadRequestException(`Password must contain ${v.join(', ')}`);
  }

  async create(dto: CreateUserDto, actor: AuthUser) {
    const role = await this.resolveRole(dto.roleKey, actor);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException('A user with this email already exists');
    }
    if (dto.password) this.checkPassword(dto.password);
    const u = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        roleId: role.id,
        departmentId: dto.departmentId ?? null,
        jobTitle: dto.jobTitle,
        phone: dto.phone,
        employeeCode: dto.employeeCode ?? null,
        location: dto.location ?? null,
        workProfileId: dto.workProfileId ?? null,
        managerId: dto.managerId ?? null,
        passwordHash: dto.password ? await hashPassword(dto.password) : null,
        passwordChangedAt: dto.password ? new Date() : null,
      },
      select: USER_PUBLIC_SELECT,
    });
    const out = this.serialize(u);
    await this.audit.log({ category: 'USER_ACTION', action: 'user.create', resourceType: 'User', resourceId: u.id, after: out });
    return out;
  }

  /** Bulk create/update employees from a parsed CSV (matched by email). */
  async importUsers(dto: ImportUsersDto, actor: AuthUser) {
    const rows = dto.rows ?? [];
    const depts = await this.prisma.department.findMany({ select: { id: true, name: true, code: true } });
    const deptByName = new Map(depts.map((d) => [d.name.toLowerCase(), d.id]));
    const deptByCode = new Map(depts.map((d) => [d.code.toUpperCase(), d.id]));
    const roles = await this.prisma.role.findMany({ select: { id: true, key: true } });
    const roleByKey = new Map(roles.map((r) => [r.key as string, r.id]));
    const employeeRoleId = roleByKey.get('EMPLOYEE');
    if (!employeeRoleId) throw new BadRequestException('EMPLOYEE role is not configured');

    const result = { created: 0, updated: 0, skipped: 0, errors: [] as { email: string; error: string }[] };
    const seen = new Set<string>();
    const managerLinks: { email: string; managerEmail: string }[] = [];

    for (const row of rows) {
      const email = row.email;
      try {
        if (seen.has(email)) {
          result.skipped++;
          continue;
        }
        seen.add(email);

        let roleId = employeeRoleId;
        if (row.roleKey) {
          if (row.roleKey === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
            throw new Error('Only a Super Admin can import a Super Admin');
          }
          roleId = roleByKey.get(row.roleKey) ?? employeeRoleId;
        }

        let departmentId: string | null | undefined;
        if (row.department) {
          const key = row.department.trim();
          departmentId = deptByName.get(key.toLowerCase()) ?? deptByCode.get(key.toUpperCase());
          if (!departmentId) throw new Error(`Unknown department "${row.department}"`);
        }

        const data = {
          displayName: row.displayName.trim(),
          employeeCode: row.employeeCode?.trim() || null,
          jobTitle: row.jobTitle?.trim() || null,
          location: row.location?.trim() || null,
          ...(departmentId ? { departmentId } : {}),
        };

        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
          await this.prisma.user.update({ where: { id: existing.id }, data: { ...data, roleId } });
          result.updated++;
        } else {
          await this.prisma.user.create({ data: { email, roleId, authProvider: 'LOCAL', ...data } });
          result.created++;
        }
        if (row.managerEmail) managerLinks.push({ email, managerEmail: row.managerEmail });
      } catch (e) {
        const msg = (e as Error).message || 'Import failed';
        result.errors.push({ email, error: /unique constraint/i.test(msg) ? 'Employee ID already used by another user' : msg });
      }
    }

    // Resolve manager relationships now that all users exist.
    if (managerLinks.length) {
      const emails = Array.from(new Set(managerLinks.flatMap((l) => [l.email, l.managerEmail])));
      const users = await this.prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
      const idByEmail = new Map(users.map((u) => [u.email, u.id]));
      for (const l of managerLinks) {
        const uid = idByEmail.get(l.email);
        const mid = idByEmail.get(l.managerEmail);
        if (uid && mid && uid !== mid) await this.prisma.user.update({ where: { id: uid }, data: { managerId: mid } });
      }
    }

    await this.audit.log({
      category: 'USER_ACTION',
      action: 'user.import',
      resourceType: 'User',
      metadata: { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length },
    });
    return result;
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    const existing = await this.prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT });
    if (!existing) throw new NotFoundException('User not found');
    if (existing.role.key === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can modify a Super Admin');
    }
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.email !== undefined && dto.email !== existing.email) {
      if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('Email already in use');
      data.email = dto.email;
    }
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.roleKey !== undefined && dto.roleKey !== existing.role.key) {
      if (id === actor.id) throw new ForbiddenException('You cannot change your own role');
      data.roleId = (await this.resolveRole(dto.roleKey, actor)).id;
    }
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.employeeCode !== undefined) data.employeeCode = dto.employeeCode;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.managerId !== undefined) data.managerId = dto.managerId;
    const workProfileChanged = dto.workProfileId !== undefined && dto.workProfileId !== existing.workProfileId;
    if (dto.workProfileId !== undefined) data.workProfileId = dto.workProfileId;
    if (dto.isActive !== undefined) {
      if (id === actor.id && !dto.isActive) throw new ForbiddenException('You cannot deactivate yourself');
      data.isActive = dto.isActive;
    }
    if (dto.password) {
      this.checkPassword(dto.password);
      data.passwordHash = await hashPassword(dto.password);
      data.passwordChangedAt = new Date();
    }
    const u = await this.prisma.user.update({ where: { id }, data, select: USER_PUBLIC_SELECT });
    if (dto.isActive === false || dto.password) await this.revokeAllSessions(id);
    await this.authCtx.invalidateUser(id);
    if (workProfileChanged) await this.reapplyPolicyForUser(id, actor);
    const out = this.serialize(u);
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'user.update',
      resourceType: 'User',
      resourceId: id,
      before: this.serialize(existing),
      after: { ...out, ...(dto.password ? { passwordChanged: true } : {}) },
    });
    return out;
  }

  private async revokeAllSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.authCtx.invalidateSessions(...sessions.map((s) => s.id));
  }

  async deactivate(id: string, actor: AuthUser) {
    if (id === actor.id) throw new ForbiddenException('You cannot deactivate yourself');
    const existing = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing) throw new NotFoundException('User not found');
    if (existing.role.key === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can deactivate a Super Admin');
    }
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    await this.revokeAllSessions(id);
    await this.authCtx.invalidateUser(id);
    await this.audit.log({ category: 'USER_ACTION', action: 'user.deactivate', resourceType: 'User', resourceId: id, before: { isActive: existing.isActive }, after: { isActive: false } });
  }

  async resetMfa(id: string, actor: AuthUser) {
    const existing = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing) throw new NotFoundException('User not found');
    if (existing.role.key === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can reset MFA for a Super Admin');
    }
    await this.prisma.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] } });
    await this.revokeAllSessions(id);
    await this.audit.log({ category: 'SECURITY', action: 'user.mfa.reset', resourceType: 'User', resourceId: id });
    return this.get(id, actor);
  }

  async unlock(id: string, actor: AuthUser) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await this.audit.log({ category: 'USER_ACTION', action: 'user.unlock', resourceType: 'User', resourceId: id, before: { lockedUntil: existing.lockedUntil } });
    return this.get(id, actor);
  }
}
