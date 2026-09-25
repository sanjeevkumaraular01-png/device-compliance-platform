import { Injectable } from '@nestjs/common';
import { RoleKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/redis.module';
import type { AuthUser } from '../common/types';

const TTL_SEC = 30;

export interface CachedUserContext {
  id: string;
  email: string;
  displayName: string;
  roleKey: RoleKey;
  roleName: string;
  permissions: string[];
  departmentId: string | null;
  managedDepartmentIds: string[];
  isActive: boolean;
}

export interface CachedSession {
  id: string;
  userId: string;
  revoked: boolean;
  expiresAt: string;
  lastSeenAt: string;
}

/** Cached (Redis, 30s) lookups of user authorization context and session state. */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getUserContext(userId: string): Promise<CachedUserContext | null> {
    const key = `sem:uctx:${userId}`;
    const cached = await this.cache.getJson<CachedUserContext>(key);
    if (cached) return cached;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, managedDepartments: { select: { id: true } } },
    });
    if (!user) return null;
    const ctx: CachedUserContext = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roleKey: user.role.key,
      roleName: user.role.name,
      permissions: user.role.permissions,
      departmentId: user.departmentId,
      managedDepartmentIds: user.managedDepartments.map((d) => d.id),
      isActive: user.isActive,
    };
    await this.cache.setJson(key, ctx, TTL_SEC);
    return ctx;
  }

  async getSession(sessionId: string): Promise<CachedSession | null> {
    const key = `sem:sess:${sessionId}`;
    const cached = await this.cache.getJson<CachedSession>(key);
    if (cached) return cached;
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s) return null;
    const value: CachedSession = {
      id: s.id,
      userId: s.userId,
      revoked: !!s.revokedAt,
      expiresAt: s.expiresAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    };
    await this.cache.setJson(key, value, TTL_SEC);
    return value;
  }

  /** Update session lastSeenAt at most once per minute. */
  async touchSession(session: CachedSession): Promise<void> {
    if (!(await this.cache.setOnce(`sem:sess-touch:${session.id}`, 60))) return;
    const now = new Date();
    await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => undefined);
    await this.cache.setJson(`sem:sess:${session.id}`, { ...session, lastSeenAt: now.toISOString() }, TTL_SEC);
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(`sem:uctx:${userId}`);
  }

  async invalidateSessions(...sessionIds: string[]): Promise<void> {
    await this.cache.del(...sessionIds.map((id) => `sem:sess:${id}`));
  }

  /** Invalidate every cached user context for a role (after permission edits). */
  async invalidateRole(roleId: string): Promise<void> {
    const users = await this.prisma.user.findMany({ where: { roleId }, select: { id: true } });
    await this.cache.del(...users.map((u) => `sem:uctx:${u.id}`));
  }

  toAuthUser(ctx: CachedUserContext, sessionId: string): AuthUser {
    return {
      id: ctx.id,
      email: ctx.email,
      displayName: ctx.displayName,
      roleKey: ctx.roleKey,
      roleName: ctx.roleName,
      permissions: ctx.permissions,
      departmentId: ctx.departmentId,
      managedDepartmentIds: ctx.managedDepartmentIds,
      sessionId,
    };
  }
}
