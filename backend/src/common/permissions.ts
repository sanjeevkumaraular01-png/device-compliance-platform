import { RoleKey } from '@prisma/client';

export const PERMISSIONS = [
  'devices:read',
  'devices:write',
  'devices:command',
  'enrollment:manage',
  'policies:read',
  'policies:write',
  'software:read',
  'software:write',
  'usb:read',
  'usb:write',
  'usb:approve',
  'usb:request',
  'security:read',
  'patches:read',
  'patches:deploy',
  'compliance:read',
  'compliance:write',
  'alerts:read',
  'alerts:write',
  'alerts:configure',
  'reports:read',
  'reports:create',
  'audit:read',
  'users:read',
  'users:write',
  'roles:write',
  'settings:write',
  'dashboard:read',
  // Workforce module (docs/WORKFORCE.md)
  'workforce:self',
  'workforce:read',
  'workforce:manage',
  'workforce:screenshots',
  'workforce:ai',
  'tasks:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const S = 'SUPER_ADMIN', SE = 'SECURITY_ADMIN', C = 'COMPLIANCE_OFFICER', I = 'IT_ADMIN',
  D = 'DEPARTMENT_MANAGER', E = 'EMPLOYEE', A = 'AUDITOR', H = 'HR_MANAGER';

/** Permission matrix from docs/API.md and docs/WORKFORCE.md. */
const MATRIX: Record<Permission, string[]> = {
  'devices:read': [S, SE, C, I, D, E, A],
  'devices:write': [S, SE, I],
  'devices:command': [S, SE, I],
  'enrollment:manage': [S, SE, I],
  'policies:read': [S, SE, C, I, D, A],
  'policies:write': [S, SE],
  'software:read': [S, SE, C, I, D, A],
  'software:write': [S, SE, I],
  'usb:read': [S, SE, C, I, D, A],
  'usb:write': [S, SE, I],
  'usb:approve': [S, SE, I, D],
  'usb:request': [S, SE, C, I, D, E],
  'security:read': [S, SE, C, I, D, A],
  'patches:read': [S, SE, C, I, D, A],
  'patches:deploy': [S, SE, I],
  'compliance:read': [S, SE, C, I, D, E, A],
  'compliance:write': [S, SE, C],
  'alerts:read': [S, SE, C, I, D, A, H],
  'alerts:write': [S, SE, C, I],
  'alerts:configure': [S, SE],
  'reports:read': [S, SE, C, I, D, A, H],
  'reports:create': [S, SE, C, I, D, A, H],
  'audit:read': [S, SE, C, A],
  'users:read': [S, SE, C, I, D, A, H],
  'users:write': [S, I],
  'roles:write': [S],
  'settings:write': [S, SE],
  'dashboard:read': [S, SE, C, I, D, E, A, H],
  'workforce:self': [S, SE, C, I, D, E, A, H],
  'workforce:read': [S, C, D, A, H],
  // IT_ADMIN: policies + app/website categories only (enforced in the workforce service layer)
  'workforce:manage': [S, I, H],
  'workforce:screenshots': [S, D],
  'workforce:ai': [S, C, D, H],
  'tasks:manage': [S, I, D, H],
};

/** Permissions introduced by the Workforce module (granted once to existing roles by the seed). */
export const WORKFORCE_PERMISSIONS: Permission[] = [
  'workforce:self',
  'workforce:read',
  'workforce:manage',
  'workforce:screenshots',
  'workforce:ai',
  'tasks:manage',
];

export function defaultPermissionsFor(role: RoleKey | string): Permission[] {
  return PERMISSIONS.filter((p) => MATRIX[p].includes(role));
}

export const ROLE_DEFINITIONS: { key: RoleKey; name: string; description: string }[] = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full access to every feature and setting' },
  { key: 'SECURITY_ADMIN', name: 'Security Admin', description: 'Manages security policies, alerts and enforcement' },
  { key: 'COMPLIANCE_OFFICER', name: 'Compliance Officer', description: 'Reviews compliance posture, audits and reports' },
  { key: 'IT_ADMIN', name: 'IT Admin', description: 'Manages devices, software, USB and patching' },
  { key: 'DEPARTMENT_MANAGER', name: 'Department Manager', description: 'Views devices and users of managed departments' },
  { key: 'EMPLOYEE', name: 'Employee', description: 'Views own devices and requests USB access' },
  { key: 'AUDITOR', name: 'Auditor', description: 'Read-only access for audits' },
  { key: 'HR_MANAGER', name: 'HR Manager', description: 'Human Resources: attendance, workforce analytics, tasks and daily reports' },
];
