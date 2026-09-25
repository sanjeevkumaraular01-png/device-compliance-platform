import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { scopedDepartmentIds } from '../common/scope';
import type { AuthUser } from '../common/types';
import type { Permission } from '../common/permissions';

/**
 * Workforce row scoping (docs/WORKFORCE.md "REST API"):
 *  - callers without `workforce:read` only ever see their own userId
 *  - DEPARTMENT_MANAGER callers are limited to departments they manage or belong to
 *  - other `workforce:read` holders (HR, compliance, auditors, super admin) see everyone
 */
export function canReadOthers(user: AuthUser): boolean {
  return user.permissions.includes('workforce:read');
}

export function isDeptLimited(user: AuthUser): boolean {
  return user.roleKey === 'DEPARTMENT_MANAGER';
}

/** Prisma filter over `User` rows visible for workforce data. */
export function workforceUserWhere(user: AuthUser, perm: Permission = 'workforce:read'): Prisma.UserWhereInput {
  if (!user.permissions.includes(perm)) return { id: user.id };
  if (isDeptLimited(user)) {
    const ids = scopedDepartmentIds(user);
    return { OR: [{ id: user.id }, { departmentId: { in: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] } }] };
  }
  return {};
}

/**
 * Throws 403 unless `user` may see workforce data of `target`.
 * Self access needs only `workforce:self`; others need `perm` (+ department scope for managers).
 */
export function assertCanView(
  user: AuthUser,
  target: { id: string; departmentId: string | null },
  perm: Permission = 'workforce:read',
  opts: { selfAllowed?: boolean } = {},
): void {
  if (target.id === user.id) {
    if (opts.selfAllowed === false) throw new ForbiddenException('Viewing your own workforce data is disabled by policy');
    return;
  }
  if (!user.permissions.includes(perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
  if (isDeptLimited(user)) {
    if (!target.departmentId || !scopedDepartmentIds(user).includes(target.departmentId)) {
      throw new ForbiddenException('Employee is outside your department scope');
    }
  }
}

/** Department filter a caller may apply (managers cannot escape their scope). */
export function assertDepartmentInScope(user: AuthUser, departmentId: string | undefined): void {
  if (!departmentId || !isDeptLimited(user)) return;
  if (!scopedDepartmentIds(user).includes(departmentId)) throw new ForbiddenException('Department is outside your scope');
}
