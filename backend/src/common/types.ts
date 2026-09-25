import { OsPlatform, RoleKey } from '@prisma/client';

/** Authenticated console user attached to `req.user`. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roleKey: RoleKey;
  roleName: string;
  permissions: string[];
  departmentId: string | null;
  /** Departments the user manages (DEPARTMENT_MANAGER scoping). */
  managedDepartmentIds: string[];
  sessionId: string;
}

/** Authenticated agent attached to `req.device`. */
export interface AgentDevice {
  id: string;
  serialNumber: string;
  platform: OsPlatform;
  deviceName: string;
  departmentId: string | null;
  assignedUserId: string | null;
  status: string;
}
