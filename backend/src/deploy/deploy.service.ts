import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256Hex } from '../common/crypto.service';
import { MailVerifier } from './mail-verifier';
import { DeploySettingsDto } from './deploy.dto';

const TOKEN_PREFIX = 'sem_enr_'; // reuse the enrollment-token format so /agent/enroll accepts it
const SETTING = {
  enabled: 'deploy.enabled',
  companyName: 'deploy.companyName',
  allowedDomains: 'deploy.allowedDomains',
  imapHost: 'deploy.imapHost',
  imapPort: 'deploy.imapPort',
  imapSecure: 'deploy.imapSecure',
  imapAllowInsecureTls: 'deploy.imapAllowInsecureTls',
};

export interface EffectiveDeployConfig {
  enabled: boolean;
  companyName: string;
  allowedDomains: string[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapAllowInsecureTls: boolean;
}

@Injectable()
export class DeployService {
  private readonly logger = new Logger(DeployService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailVerifier,
  ) {}

  /** Settings (admin overrides) take precedence over env defaults. */
  async effectiveConfig(): Promise<EffectiveDeployConfig> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: Object.values(SETTING) } } });
    const s = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const pick = <T>(key: string, fallback: T): T => (s.has(key) && s.get(key) !== null ? (s.get(key) as T) : fallback);
    return {
      enabled: pick(SETTING.enabled, this.config.deployEnabledEnv),
      companyName: pick(SETTING.companyName, this.config.deployCompanyName),
      allowedDomains: pick(SETTING.allowedDomains, this.config.deployAllowedDomains).map((d) => d.toLowerCase()),
      imapHost: pick(SETTING.imapHost, this.config.deployImapHost),
      imapPort: pick(SETTING.imapPort, this.config.deployImapPort),
      imapSecure: pick(SETTING.imapSecure, this.config.deployImapSecure),
      imapAllowInsecureTls: pick(SETTING.imapAllowInsecureTls, false),
    };
  }

  private get downloadBase() {
    return this.config.deployDownloadBaseUrl;
  }
  private get msiUrl() {
    return `${this.downloadBase}/SecureEndpoint-Agent-x64.msi`;
  }

  /** Public info for the /install page (no secrets). */
  async publicConfig() {
    const c = await this.effectiveConfig();
    return {
      enabled: c.enabled && !!c.imapHost,
      companyName: c.companyName,
      allowedDomains: c.allowedDomains,
      agentDownloadUrl: this.msiUrl,
    };
  }

  private assertConfigured(c: EffectiveDeployConfig) {
    if (!c.enabled || !c.imapHost) {
      throw new ServiceUnavailableException('Self-service deployment is not configured');
    }
  }

  private domainOf(email: string) {
    return email.split('@')[1]?.toLowerCase() ?? '';
  }

  /** Verify company email, resolve the employee, mint a single-use bound credential. */
  async createSession(rawEmail: string, password: string, ip: string | null) {
    const email = rawEmail.trim().toLowerCase();
    const c = await this.effectiveConfig();
    this.assertConfigured(c);

    if (c.allowedDomains.length && !c.allowedDomains.includes(this.domainOf(email))) {
      await this.audit.log({
        category: 'AUTH', action: 'deploy.session.rejected', actorType: 'SYSTEM', actorName: email,
        ipAddress: ip, success: false, metadata: { reason: 'domain_not_allowed' },
      });
      throw new ForbiddenException(`Only company email addresses are allowed (${c.allowedDomains.map((d) => '@' + d).join(', ')})`);
    }

    const result = await this.mail.verify(email, password, {
      host: c.imapHost, port: c.imapPort, secure: c.imapSecure, allowInsecureTls: c.imapAllowInsecureTls,
    });
    if (result === 'UNAVAILABLE') {
      throw new ServiceUnavailableException('The company mail server could not be reached. Try again shortly.');
    }
    if (result === 'INVALID_CREDENTIALS') {
      await this.audit.log({
        category: 'AUTH', action: 'deploy.session.failed', actorType: 'SYSTEM', actorName: email,
        ipAddress: ip, success: false, metadata: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Incorrect company email or password');
    }

    const user = await this.resolveEmployee(email);

    const token = randomToken(TOKEN_PREFIX, 32);
    const ttlMs = this.config.deploySessionTtlMin * 60_000;
    const row = await this.prisma.enrollmentToken.create({
      data: {
        name: `Self-deploy: ${email}`,
        tokenHash: sha256Hex(token),
        tokenPrefix: token.substring(0, TOKEN_PREFIX.length + 6),
        platform: 'WINDOWS',
        assignToUserId: user.id,
        departmentId: user.departmentId,
        maxUses: 1,
        autoApprove: false, // admin approves each self-enrolled device
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    await this.audit.log({
      category: 'AUTH', action: 'deploy.session.create', actorType: 'USER', actorId: user.id, actorName: email,
      resourceType: 'EnrollmentToken', resourceId: row.id, ipAddress: ip, metadata: { email },
    });

    const serverUrl = this.config.apiPublicUrl;
    return {
      deployToken: token,
      expiresAt: row.expiresAt.toISOString(),
      employee: { email: user.email, displayName: user.displayName },
      downloadUrl: this.msiUrl,
      setupUrl: `${serverUrl}/api/v1/deploy/setup.cmd?token=${encodeURIComponent(token)}`,
      serverUrl,
      instructions:
        'Download and run SecureEndpoint-Setup, or install the MSI with the command shown. Your device will register automatically and appear for admin approval.',
    };
  }

  /** Find the employee by email, or provision one (role EMPLOYEE, provider IMAP). */
  private async resolveEmployee(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (!existing.isActive) throw new ForbiddenException('This account is disabled');
      return existing;
    }
    const role = await this.prisma.role.findUniqueOrThrow({ where: { key: 'EMPLOYEE' } });
    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0].replace(/[._]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
        authProvider: 'IMAP',
        roleId: role.id,
      },
    });
    await this.audit.log({
      category: 'USER_ACTION', action: 'user.provision', actorType: 'SYSTEM', actorName: 'deploy',
      resourceType: 'User', resourceId: user.id, metadata: { email, via: 'self-enroll' },
    });
    return user;
  }

  private async tokenByRaw(token: string) {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    return this.prisma.enrollmentToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  }

  /** State of a deployment credential and the device it produced (for the /install page). */
  async status(token: string) {
    const t = await this.tokenByRaw(token);
    if (!t || !t.assignToUserId) return { state: 'EXPIRED' as const };
    if (t.usedCount < 1) {
      if (t.revokedAt || t.expiresAt < new Date()) return { state: 'EXPIRED' as const };
      return { state: 'PENDING_DOWNLOAD' as const };
    }
    // Consumed: the newest device bound to this employee since the credential was issued.
    const device = await this.prisma.device.findFirst({
      where: { assignedUserId: t.assignToUserId, createdAt: { gte: new Date(t.createdAt.getTime() - 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { deviceName: true, osName: true, osVersion: true, status: true, lastSeenAt: true, complianceState: true },
    });
    if (!device) return { state: 'ENROLLED_PENDING_APPROVAL' as const };
    return {
      state: device.status === 'PENDING' ? ('ENROLLED_PENDING_APPROVAL' as const) : ('ACTIVE' as const),
      device: {
        name: device.deviceName,
        os: [device.osName, device.osVersion].filter(Boolean).join(' '),
        status: device.status,
        lastSeenAt: device.lastSeenAt,
        complianceState: device.complianceState,
      },
    };
  }

  /** Personalized one-click setup script (installs the MSI with the one-time token). */
  async setupCmd(token: string): Promise<string> {
    const t = await this.tokenByRaw(token);
    if (!t || !t.assignToUserId || t.revokedAt || t.expiresAt < new Date() || t.usedCount >= t.maxUses) {
      throw new UnauthorizedException('This deployment link is invalid or has expired. Please sign in again.');
    }
    const server = this.config.apiPublicUrl;
    const msi = this.msiUrl;
    // Downloads the MSI to %TEMP% and installs it with the one-time token as an MSI property.
    return [
      '@echo off',
      'setlocal',
      'echo Installing SecureEndpoint Agent...',
      `set "SERVER=${server}"`,
      `set "DEPLOY_TOKEN=${token}"`,
      `set "MSIURL=${msi}"`,
      'set "MSI=%TEMP%\\SecureEndpoint-Agent-x64.msi"',
      'powershell -NoProfile -Command "try { Invoke-WebRequest -Uri $env:MSIURL -OutFile $env:MSI -UseBasicParsing } catch { Write-Host $_; exit 1 }"',
      'if not exist "%MSI%" ( echo Download failed & pause & exit /b 1 )',
      'msiexec /i "%MSI%" SERVER="%SERVER%" DEPLOY_TOKEN="%DEPLOY_TOKEN%" /qb /norestart',
      'if %ERRORLEVEL% NEQ 0 ( echo Install failed (%ERRORLEVEL%) & pause & exit /b %ERRORLEVEL% )',
      'echo.',
      'echo SecureEndpoint Agent installed. Your device is now registering.',
      'echo You can close this window.',
      'timeout /t 8 >nul',
      'endlocal',
      '',
    ].join('\r\n');
  }

  // ── admin settings ──
  async getSettings() {
    const c = await this.effectiveConfig();
    return {
      enabled: c.enabled,
      companyName: c.companyName,
      allowedDomains: c.allowedDomains,
      imapHost: c.imapHost,
      imapPort: c.imapPort,
      imapSecure: c.imapSecure,
      configured: !!c.imapHost,
      installUrl: `${this.config.webUrl}/install`,
      agentDownloadUrl: this.msiUrl,
    };
  }

  async updateSettings(dto: DeploySettingsDto, actorId: string | null) {
    const map: Record<string, unknown> = {};
    if (dto.enabled !== undefined) map[SETTING.enabled] = dto.enabled;
    if (dto.companyName !== undefined) map[SETTING.companyName] = dto.companyName;
    if (dto.allowedDomains !== undefined) {
      map[SETTING.allowedDomains] = dto.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    }
    if (dto.imapHost !== undefined) map[SETTING.imapHost] = dto.imapHost.trim();
    if (dto.imapPort !== undefined) map[SETTING.imapPort] = dto.imapPort;
    if (dto.imapSecure !== undefined) map[SETTING.imapSecure] = dto.imapSecure;
    for (const [key, value] of Object.entries(map)) {
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: value as never },
        update: { value: value as never },
      });
    }
    await this.audit.log({
      category: 'POLICY_CHANGE', action: 'deploy.settings.update', actorType: 'USER', actorId,
      resourceType: 'SystemSetting', metadata: { keys: Object.keys(map) },
    });
    return this.getSettings();
  }
}
