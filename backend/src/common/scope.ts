import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from './types';

/**
 * Row scoping (docs/API.md): DEPARTMENT_MANAGER sees devices/users/events of their
 * department(s); EMPLOYEE sees only devices assigned to them. Other roles: unrestricted.
 */
export function scopedDepartmentIds(user: AuthUser): string[] {
  const ids = new Set(user.managedDepartmentIds);
  if (user.departmentId) ids.add(user.departmentId);
  return [...ids];
}

export function isScoped(user: AuthUser | undefined): boolean {
  return !!user && (user.roleKey === 'DEPARTMENT_MANAGER' || user.roleKey === 'EMPLOYEE');
}

export function deviceScope(user: AuthUser | undefined): Prisma.DeviceWhereInput {
  if (!user) return {};
  if (user.roleKey === 'DEPARTMENT_MANAGER') {
    return { departmentId: { in: scopedDepartmentIds(user) } };
  }
  if (user.roleKey === 'EMPLOYEE') {
    return { assignedUserId: user.id };
  }
  return {};
}

export function userScope(user: AuthUser | undefined): Prisma.UserWhereInput {
  if (!user) return {};
  if (user.roleKey === 'DEPARTMENT_MANAGER') {
    return { departmentId: { in: scopedDepartmentIds(user) } };
  }
  if (user.roleKey === 'EMPLOYEE') return { id: user.id };
  return {};
}

/** Relation filter `{ device: <scope> }` for device-owned rows, or {} when unscoped. */
export function viaDevice(user: AuthUser | undefined): { device?: Prisma.DeviceWhereInput } {
  return isScoped(user) ? { device: deviceScope(user) } : {};
}

/** SQL fragment restricting alias `d` (devices table) to the user's scope. */
export function deviceScopeSql(user: AuthUser | undefined, alias = 'd'): Prisma.Sql {
  if (!user) return Prisma.sql`TRUE`;
  const a = Prisma.raw(alias);
  if (user.roleKey === 'DEPARTMENT_MANAGER') {
    const ids = scopedDepartmentIds(user);
    if (!ids.length) return Prisma.sql`FALSE`;
    return Prisma.sql`${a}.department_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
  }
  if (user.roleKey === 'EMPLOYEE') return Prisma.sql`${a}.assigned_user_id = ${user.id}::uuid`;
  return Prisma.sql`TRUE`;
}

/** Ensure a single device is inside the user's scope (throws 404-like 403). */
export function assertDeviceInScope(
  user: AuthUser | undefined,
  device: { departmentId: string | null; assignedUserId: string | null },
): void {
  if (!user || !isScoped(user)) return;
  if (user.roleKey === 'DEPARTMENT_MANAGER') {
    if (!device.departmentId || !scopedDepartmentIds(user).includes(device.departmentId)) {
      throw new ForbiddenException('Device is outside your scope');
    }
  } else if (user.roleKey === 'EMPLOYEE' && device.assignedUserId !== user.id) {
    throw new ForbiddenException('Device is outside your scope');
  }
}
