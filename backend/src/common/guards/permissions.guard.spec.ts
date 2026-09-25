import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import { defaultPermissionsFor, PERMISSIONS } from '../permissions';
import type { AuthUser } from '../types';

function ctx(meta: Record<string, unknown>, user?: Partial<AuthUser>): ExecutionContext {
  const handler = () => undefined;
  const cls = class {};
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const user = (role: AuthUser['roleKey']): Partial<AuthUser> => ({ id: 'u', roleKey: role, permissions: defaultPermissionsFor(role) });

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows routes without required permissions', () => {
    expect(guard.canActivate(ctx({}, user('EMPLOYEE')))).toBe(true);
  });

  it('allows when the user has all required permissions', () => {
    expect(guard.canActivate(ctx({ [PERMISSIONS_KEY]: ['devices:read', 'devices:write'] }, user('IT_ADMIN')))).toBe(true);
  });

  it('denies with 403 when a permission is missing', () => {
    expect(() => guard.canActivate(ctx({ [PERMISSIONS_KEY]: ['devices:write'] }, user('AUDITOR')))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ [PERMISSIONS_KEY]: ['roles:write'] }, user('SECURITY_ADMIN')))).toThrow(/roles:write/);
  });

  it('denies when there is no authenticated user', () => {
    expect(() => guard.canActivate(ctx({ [PERMISSIONS_KEY]: ['devices:read'] }))).toThrow(ForbiddenException);
  });

  it('allows public routes without a user', () => {
    expect(guard.canActivate(ctx({ [PERMISSIONS_KEY]: ['devices:read'], [IS_PUBLIC_KEY]: true }))).toBe(true);
  });
});

describe('permission matrix (docs/API.md)', () => {
  it('SUPER_ADMIN has every permission', () => {
    expect(defaultPermissionsFor('SUPER_ADMIN')).toEqual([...PERMISSIONS]);
  });
  it('EMPLOYEE has only devices:read, usb:request, compliance:read, dashboard:read', () => {
    expect(defaultPermissionsFor('EMPLOYEE').sort()).toEqual(['compliance:read', 'dashboard:read', 'devices:read', 'usb:request']);
  });
  it('AUDITOR is read-only (plus reports:create)', () => {
    const p = defaultPermissionsFor('AUDITOR');
    expect(p.filter((x) => !x.endsWith(':read'))).toEqual(['reports:create']);
    expect(p).toContain('audit:read');
  });
  it('spot checks', () => {
    expect(defaultPermissionsFor('DEPARTMENT_MANAGER')).toContain('usb:approve');
    expect(defaultPermissionsFor('DEPARTMENT_MANAGER')).not.toContain('audit:read');
    expect(defaultPermissionsFor('IT_ADMIN')).toContain('users:write');
    expect(defaultPermissionsFor('SECURITY_ADMIN')).not.toContain('users:write');
    expect(defaultPermissionsFor('COMPLIANCE_OFFICER')).toContain('compliance:write');
    expect(defaultPermissionsFor('SECURITY_ADMIN')).toContain('alerts:configure');
    expect(defaultPermissionsFor('IT_ADMIN')).not.toContain('alerts:configure');
  });
});
