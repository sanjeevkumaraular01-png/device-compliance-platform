import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, Prisma, RoleKey } from '@prisma/client';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { CryptoService, safeEqual, sha256Hex } from '../common/crypto.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../metrics/metrics.service';
import { SettingsService } from '../settings/settings.service';
import { AuthContextService } from './auth-context.service';
import { dummyVerify, hashPassword, passwordPolicyViolations, verifyPassword } from './password.util';
import type { AuthUser } from '../common/types';

authenticator.options = { window: 1, step: 30, digits: 6 };

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MFA_TOKEN_TTL = 300;

export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export interface CurrentUserDto {
  id: string;
  email: string;
  displayName: string;
  role: RoleKey;
  roleName: string;
  permissions: string[];
  departmentId: string | null;
  departmentName: string | null;
  mfaEnabled: boolean;
  authProvider: AuthProvider;
  lastLoginAt: string | null;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: CurrentUserDto;
}

export type LoginResult =
  | { mfaRequired: true; mfaToken: string }
  | ({ mfaRequired: false; mfaEnrollmentRequired: boolean } & TokenResponse);

type UserWithRelations = Prisma.UserGetPayload<{ include: { role: true; department: true } }>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly settings: SettingsService,
    private readonly ctx: AuthContextService,
  ) {}

  toCurrentUser(user: UserWithRelations): CurrentUserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role.key,
      roleName: user.role.name,
      permissions: user.role.permissions,
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
      mfaEnabled: user.mfaEnabled,
      authProvider: user.authProvider,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    };
  }

  private loadUser(id: string) {
    return this.prisma.user.findUnique({ where: { id }, include: { role: true, department: true } });
  }

  async me(userId: string): Promise<CurrentUserDto> {
    const user = await this.loadUser(userId);
    if (!user) throw new NotFoundException('User not found');
    return this.toCurrentUser(user);
  }

  async recordLogin(
    email: string,
    provider: AuthProvider,
    success: boolean,
    client: ClientInfo,
    userId: string | null,
    reason?: string,
    mfaUsed = false,
  ) {
    this.metrics.loginAttempts.inc({ result: success ? 'success' : 'failure' });
    await this.prisma.loginHistory
      .create({
        data: {
          email: email.substring(0, 254),
          provider,
          success,
          reason,
          userId,
          ipAddress: client.ip ?? null,
          userAgent: client.userAgent?.substring(0, 512) ?? null,
          mfaUsed,
        },
      })
      .catch((e) => this.logger.warn(`login history write failed: ${e.message}`));
    await this.audit.log({
      category: 'AUTH',
      action: success ? 'auth.login.success' : 'auth.login.failure',
      actorType: 'USER',
      actorId: userId,
      actorName: email,
      resourceType: 'User',
      resourceId: userId,
      success,
      ipAddress: client.ip ?? null,
      userAgent: client.userAgent ?? null,
      metadata: { provider, ...(reason ? { reason } : {}), ...(mfaUsed ? { mfaUsed } : {}) },
    });
  }

  // ── Local login ──
  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { role: true, department: true },
    });
    if (!user) {
      await dummyVerify(password);
      await this.recordLogin(normalized, 'LOCAL', false, client, null, 'unknown_user');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLogin(normalized, 'LOCAL', false, client, user.id, 'locked');
      throw new UnauthorizedException(
        `Account is locked due to repeated failed logins. Try again after ${user.lockedUntil.toISOString()}`,
      );
    }
    if (!user.passwordHash) {
      await dummyVerify(password);
      await this.recordLogin(normalized, 'LOCAL', false, client, user.id, 'no_local_password');
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await this.recordLogin(normalized, 'LOCAL', false, client, user.id, lock ? 'bad_password_locked' : 'bad_password');
      if (lock) {
        await this.audit.log({
          category: 'AUTH',
          action: 'auth.account.locked',
          actorType: 'SYSTEM',
          resourceType: 'User',
          resourceId: user.id,
          metadata: { email: normalized, minutes: LOCK_MINUTES },
        });
      }
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      await this.recordLogin(normalized, 'LOCAL', false, client, user.id, 'inactive');
      throw new UnauthorizedException('Account is disabled');
    }
    return this.completePrimaryAuth(user, 'LOCAL', client);
  }

  /** After a successful first factor (local, LDAP or SSO). */
  async completePrimaryAuth(user: UserWithRelations, provider: AuthProvider, client: ClientInfo): Promise<LoginResult> {
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }
    if (user.mfaEnabled && user.mfaSecretEnc) {
      const mfaToken = await this.jwt.signAsync(
        { sub: user.id, typ: 'mfa', prv: provider },
        { expiresIn: MFA_TOKEN_TTL },
      );
      await this.audit.log({
        category: 'AUTH',
        action: 'auth.mfa.challenge',
        actorType: 'USER',
        actorId: user.id,
        actorName: user.email,
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: client.ip ?? null,
        userAgent: client.userAgent ?? null,
        metadata: { provider },
      });
      return { mfaRequired: true, mfaToken };
    }
    await this.recordLogin(user.email, provider, true, client, user.id);
    const tokens = await this.issueTokens(user, client, false);
    const required = await this.settings.mfaRequiredRoles();
    return { mfaRequired: false, mfaEnrollmentRequired: required.includes(user.role.key) && !user.mfaEnabled, ...tokens };
  }

  async verifyMfa(mfaToken: string, code: string, client: ClientInfo): Promise<TokenResponse> {
    let payload: { sub: string; typ: string; prv?: AuthProvider };
    try {
      payload = await this.jwt.verifyAsync(mfaToken, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('MFA token is invalid or expired');
    }
    if (payload.typ !== 'mfa') throw new UnauthorizedException('MFA token is invalid or expired');
    const user = await this.loadUser(payload.sub);
    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecretEnc) {
      throw new UnauthorizedException('MFA is not available for this account');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is locked. Try again later');
    }
    const ok = await this.checkSecondFactor(user, code);
    const provider = payload.prv ?? user.authProvider;
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await this.recordLogin(user.email, provider, false, client, user.id, 'bad_mfa_code', true);
      throw new UnauthorizedException('Invalid verification code');
    }
    await this.recordLogin(user.email, provider, true, client, user.id, undefined, true);
    return this.issueTokens(user, client, true);
  }

  /** Validate a TOTP code or consume a recovery code. */
  private async checkSecondFactor(user: UserWithRelations, code: string): Promise<boolean> {
    const clean = code.replace(/\s+/g, '');
    if (/^\d{6}$/.test(clean) && user.mfaSecretEnc) {
      const secret = this.crypto.decrypt(user.mfaSecretEnc);
      if (authenticator.check(clean, secret)) return true;
    }
    const hash = sha256Hex(clean.toLowerCase());
    const idx = user.mfaRecoveryHashes.findIndex((h) => safeEqual(h, hash));
    if (idx >= 0) {
      const remaining = user.mfaRecoveryHashes.filter((_, i) => i !== idx);
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: remaining } });
      await this.audit.log({
        category: 'AUTH',
        action: 'auth.mfa.recovery_code_used',
        actorType: 'USER',
        actorId: user.id,
        actorName: user.email,
        resourceType: 'User',
        resourceId: user.id,
        metadata: { remaining: remaining.length },
      });
      return true;
    }
    return false;
  }

  async issueTokens(user: UserWithRelations, client: ClientInfo, mfaVerified: boolean): Promise<TokenResponse> {
    const refreshToken = this.crypto.randomToken('sem_rt_', 48);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256Hex(refreshToken),
        ipAddress: client.ip ?? null,
        userAgent: client.userAgent?.substring(0, 512) ?? null,
        mfaVerified,
        expiresAt: new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000),
      },
    });
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: client.ip ?? null },
      include: { role: true, department: true },
    });
    const accessToken = await this.signAccess(updated.id, session.id, updated.role.key);
    return { accessToken, refreshToken, expiresIn: this.config.jwtAccessTtl, user: this.toCurrentUser(updated) };
  }

  private signAccess(userId: string, sessionId: string, role: RoleKey): Promise<string> {
    return this.jwt.signAsync({ sub: userId, sid: sessionId, role, typ: 'access' }, { expiresIn: this.config.jwtAccessTtl });
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenResponse> {
    if (!refreshToken.startsWith('sem_rt_')) throw new UnauthorizedException('Invalid refresh token');
    const hash = sha256Hex(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!session || !safeEqual(session.refreshTokenHash, hash)) {
      await this.handleRefreshTokenReuse(hash, client);
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (session.revokedAt) throw new UnauthorizedException('Session has been revoked');
    const now = Date.now();
    if (session.expiresAt.getTime() < now) throw new UnauthorizedException('Session expired');
    const idleMin = await this.settings.sessionTimeoutMinutes();
    if (now - session.lastSeenAt.getTime() > idleMin * 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await this.ctx.invalidateSessions(session.id);
      throw new UnauthorizedException('Session expired due to inactivity');
    }
    const user = await this.loadUser(session.userId);
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');

    const newToken = this.crypto.randomToken('sem_rt_', 48);
    // Rotation: conditional update guards against concurrent reuse of the same token.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        refreshTokenHash: sha256Hex(newToken),
        previousTokenHash: hash,
        lastSeenAt: new Date(),
        ipAddress: client.ip ?? session.ipAddress,
        userAgent: client.userAgent?.substring(0, 512) ?? session.userAgent,
        expiresAt: new Date(now + this.config.refreshTokenTtlDays * 86_400_000),
      },
    });
    if (rotated.count !== 1) throw new UnauthorizedException('Invalid refresh token');
    await this.ctx.invalidateSessions(session.id);
    const accessToken = await this.signAccess(user.id, session.id, user.role.key);
    return { accessToken, refreshToken: newToken, expiresIn: this.config.jwtAccessTtl, user: this.toCurrentUser(user) };
  }

  /**
   * A refresh token that was already rotated out is being replayed: either the
   * legitimate client or an attacker holds a stolen copy. Revoke the whole session
   * so neither can continue, and record it for the security team.
   */
  private async handleRefreshTokenReuse(hash: string, client: ClientInfo): Promise<void> {
    const reused = await this.prisma.session.findFirst({ where: { previousTokenHash: hash, revokedAt: null } });
    if (!reused) return;
    await this.prisma.session.update({ where: { id: reused.id }, data: { revokedAt: new Date() } });
    await this.ctx.invalidateSessions(reused.id);
    await this.audit.log({
      category: 'AUTH',
      action: 'auth.refresh.reuse_detected',
      actorType: 'USER',
      actorId: reused.userId,
      resourceType: 'Session',
      resourceId: reused.id,
      ipAddress: client.ip ?? null,
      userAgent: client.userAgent ?? null,
      success: false,
      metadata: { sessionRevoked: true },
    });
  }

  async logout(refreshToken: string | undefined, current?: AuthUser): Promise<void> {
    let sessionId: string | undefined;
    let userId: string | undefined;
    if (refreshToken) {
      const s = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256Hex(refreshToken) } });
      if (s) {
        sessionId = s.id;
        userId = s.userId;
      }
    }
    if (!sessionId && current) {
      sessionId = current.sessionId;
      userId = current.id;
    }
    if (!sessionId) return;
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.ctx.invalidateSessions(sessionId);
    await this.audit.log({
      category: 'AUTH',
      action: 'auth.logout',
      actorType: 'USER',
      actorId: userId ?? null,
      resourceType: 'Session',
      resourceId: sessionId,
    });
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!u) throw new NotFoundException('User not found');
    if (u.authProvider !== 'LOCAL') throw new UnprocessableEntityException('Password is managed by your identity provider');
    if (!(await verifyPassword(u.passwordHash, currentPassword))) {
      await this.audit.log({ category: 'AUTH', action: 'auth.password.change', success: false, resourceType: 'User', resourceId: u.id, metadata: { reason: 'bad_current_password' } });
      throw new BadRequestException('Current password is incorrect');
    }
    const violations = passwordPolicyViolations(newPassword);
    if (violations.length) throw new BadRequestException(`Password must contain ${violations.join(', ')}`);
    if (await verifyPassword(u.passwordHash, newPassword)) {
      throw new BadRequestException('New password must differ from the current password');
    }
    await this.prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
    });
    const others = await this.prisma.session.findMany({
      where: { userId: u.id, revokedAt: null, id: { not: user.sessionId } },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { id: { in: others.map((s) => s.id) } },
      data: { revokedAt: new Date() },
    });
    await this.ctx.invalidateSessions(...others.map((s) => s.id));
    await this.audit.log({ category: 'AUTH', action: 'auth.password.change', resourceType: 'User', resourceId: u.id, metadata: { revokedSessions: others.length } });
  }

  // ── MFA enrolment ──
  async mfaSetup(user: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!u) throw new NotFoundException('User not found');
    if (u.mfaEnabled) throw new UnprocessableEntityException('MFA is already enabled; disable it first');
    const secret = authenticator.generateSecret(20);
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaSecretEnc: this.crypto.encrypt(secret) } });
    const otpauthUrl = authenticator.keyuri(u.email, 'SecureEndpoint Manager', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    await this.audit.log({ category: 'AUTH', action: 'auth.mfa.setup', resourceType: 'User', resourceId: u.id });
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async mfaEnable(user: AuthUser, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!u) throw new NotFoundException('User not found');
    if (u.mfaEnabled) throw new UnprocessableEntityException('MFA is already enabled');
    if (!u.mfaSecretEnc) throw new UnprocessableEntityException('Call /auth/mfa/setup first');
    const secret = this.crypto.decrypt(u.mfaSecretEnc);
    if (!authenticator.check(code.replace(/\s+/g, ''), secret)) throw new BadRequestException('Invalid verification code');
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const hex = randomBytes(5).toString('hex');
      return `${hex.substring(0, 5)}-${hex.substring(5)}`;
    });
    await this.prisma.user.update({
      where: { id: u.id },
      data: { mfaEnabled: true, mfaRecoveryHashes: recoveryCodes.map((c) => sha256Hex(c)) },
    });
    await this.audit.log({ category: 'AUTH', action: 'auth.mfa.enable', resourceType: 'User', resourceId: u.id });
    return { recoveryCodes };
  }

  async mfaDisable(user: AuthUser, code: string) {
    const u = await this.loadUser(user.id);
    if (!u) throw new NotFoundException('User not found');
    if (!u.mfaEnabled) throw new UnprocessableEntityException('MFA is not enabled');
    if (!(await this.checkSecondFactor(u, code))) throw new BadRequestException('Invalid verification code');
    const required = await this.settings.mfaRequiredRoles();
    if (required.includes(u.role.key)) {
      throw new ForbiddenException('MFA is mandatory for your role and cannot be disabled');
    }
    await this.prisma.user.update({
      where: { id: u.id },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] },
    });
    await this.audit.log({ category: 'AUTH', action: 'auth.mfa.disable', resourceType: 'User', resourceId: u.id });
  }

  // ── Sessions ──
  async listSessions(user: AuthUser) {
    const sessions = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      mfaVerified: s.mfaVerified,
      current: s.id === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, sessionId: string) {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s || s.userId !== user.id) throw new NotFoundException('Session not found');
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: s.revokedAt ?? new Date() } });
    await this.ctx.invalidateSessions(sessionId);
    await this.audit.log({ category: 'AUTH', action: 'auth.session.revoke', resourceType: 'Session', resourceId: sessionId });
  }

  async revokeOtherSessions(user: AuthUser) {
    const others = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } },
      select: { id: true },
    });
    await this.prisma.session.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { revokedAt: new Date() } });
    await this.ctx.invalidateSessions(...others.map((o) => o.id));
    await this.audit.log({ category: 'AUTH', action: 'auth.session.revoke_all', resourceType: 'User', resourceId: user.id, metadata: { count: others.length } });
  }

  /**
   * Find or provision a user authenticated by an external IdP. Role is synced
   * from group mappings on every login.
   */
  async provisionExternalUser(input: {
    provider: AuthProvider;
    externalId: string;
    email: string;
    displayName: string;
    role: RoleKey;
    roleFromGroups: boolean;
  }): Promise<UserWithRelations> {
    const email = input.email.trim().toLowerCase();
    const role = await this.prisma.role.findUnique({ where: { key: input.role } });
    if (!role) throw new UnprocessableEntityException(`Role ${input.role} not found`);
    let user = await this.prisma.user.findUnique({
      where: { authProvider_externalId: { authProvider: input.provider, externalId: input.externalId } },
      include: { role: true, department: true },
    });
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email }, include: { role: true, department: true } });
      if (byEmail) {
        if (byEmail.authProvider !== input.provider && byEmail.authProvider !== 'LOCAL') {
          throw new UnauthorizedException('Account is linked to a different identity provider');
        }
        if (byEmail.authProvider === 'LOCAL' && byEmail.passwordHash) {
          throw new UnauthorizedException('A local account with this email already exists; ask an administrator to link it');
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { authProvider: input.provider, externalId: input.externalId },
          include: { role: true, department: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email,
            displayName: input.displayName || email,
            authProvider: input.provider,
            externalId: input.externalId,
            roleId: role.id,
          },
          include: { role: true, department: true },
        });
        await this.audit.log({
          category: 'USER_ACTION',
          action: 'user.provision',
          actorType: 'SYSTEM',
          resourceType: 'User',
          resourceId: user.id,
          after: { email, provider: input.provider, role: input.role },
        });
      }
    }
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');
    const updates: Prisma.UserUpdateInput = {};
    if (input.roleFromGroups && user.roleId !== role.id) updates.role = { connect: { id: role.id } };
    if (input.displayName && user.displayName !== input.displayName) updates.displayName = input.displayName;
    if (Object.keys(updates).length) {
      const before = { role: user.role.key };
      user = await this.prisma.user.update({ where: { id: user.id }, data: updates, include: { role: true, department: true } });
      await this.ctx.invalidateUser(user.id);
      if (updates.role) {
        await this.audit.log({
          category: 'USER_ACTION',
          action: 'user.role.sync',
          actorType: 'SYSTEM',
          resourceType: 'User',
          resourceId: user.id,
          before,
          after: { role: user.role.key },
        });
      }
    }
    return user;
  }
}
