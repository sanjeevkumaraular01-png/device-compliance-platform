import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256Hex } from '../common/crypto.service';
import { MailVerifier } from './mail-verifier';
import { DeploySettingsDto } from './deploy.dto';

const TOKEN_PREFIX = 'sem_enr_'; // reuse the enrollment-token format so /agent/enroll accepts it

/** True for localhost or a private LAN address (self-signed cert / office-LAN dev). */
function isPrivateOrLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i.test(url);
}
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
    // The MSI is not built yet; the one-click setup.cmd and manual flow use the
    // agent .exe, which is what /downloads actually serves.
    return `${this.downloadBase}/sem-agent-windows-amd64.exe`;
  }

  /** Public info for the /install page (no secrets). */
  async publicConfig() {
    const c = await this.effectiveConfig();
    return {
      enabled: c.enabled,
      companyName: c.companyName,
      identifier: 'employeeCode' as const,
      agentDownloadUrl: this.msiUrl,
    };
  }

  private assertConfigured(c: EffectiveDeployConfig) {
    if (!c.enabled) {
      throw new ServiceUnavailableException('Self-service deployment is disabled');
    }
  }

  private domainOf(email: string) {
    return email.split('@')[1]?.toLowerCase() ?? '';
  }

  /** Resolve the employee by Employee ID and mint a single-use bound credential.
   *  No password: the Employee ID is not a secret, so admin approval of each
   *  self-enrolled device (autoApprove:false) is the security gate. */
  async createSession(rawCode: string, ip: string | null) {
    const c = await this.effectiveConfig();
    this.assertConfigured(c);

    const employeeCode = rawCode.trim();
    if (!employeeCode) throw new BadRequestException('Employee ID is required');

    // Case-insensitive match so employees don't have to reproduce the exact casing
    // of their Employee ID (e.g. CSS0004 / css0004 both resolve).
    const user = await this.prisma.user.findFirst({ where: { employeeCode: { equals: employeeCode, mode: 'insensitive' } } });
    if (!user) {
      await this.audit.log({
        category: 'AUTH', action: 'deploy.session.rejected', actorType: 'SYSTEM', actorName: employeeCode,
        ipAddress: ip, success: false, metadata: { reason: 'employee_not_found' },
      });
      throw new UnauthorizedException('Employee ID not recognized. Please contact IT.');
    }
    if (!user.isActive) throw new ForbiddenException('This account is disabled. Please contact IT.');

    const token = randomToken(TOKEN_PREFIX, 32);
    const ttlMs = this.config.deploySessionTtlMin * 60_000;
    const row = await this.prisma.enrollmentToken.create({
      data: {
        name: `Self-deploy: ${employeeCode}`,
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
      category: 'AUTH', action: 'deploy.session.create', actorType: 'USER', actorId: user.id, actorName: user.displayName,
      resourceType: 'EnrollmentToken', resourceId: row.id, ipAddress: ip, metadata: { employeeCode },
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
    const base = this.downloadBase;
    // A self-signed cert is used on localhost / office-LAN dev; trust it (and skip agent
    // TLS verify) only for localhost and private LAN IPs — a public domain must present a
    // valid certificate.
    const isLocalOrPrivate = isPrivateOrLocalUrl(server);
    const trustLine = isLocalOrPrivate ? '[Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; ' : '';
    const insecure = isLocalOrPrivate ? ' --insecure-skip-verify' : '';
    const curlInsecure = isLocalOrPrivate ? '-k ' : '';
    // Downloads the agent .exe and runs enroll + service install with the one-time token.
    return [
      '@echo off',
      'setlocal',
      'echo Installing SecureEndpoint Agent...',
      'net session >nul 2>&1',
      'if %errorlevel% NEQ 0 ( echo Please right-click this file and choose "Run as administrator". & pause & exit /b 1 )',
      `set "SERVER=${server}"`,
      `set "DEPLOY_TOKEN=${token}"`,
      `set "BASE=${base}"`,
      'set "ARCH=amd64"',
      'if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"',
      'set "EXEURL=%BASE%/sem-agent-windows-%ARCH%.exe"',
      'set "DIR=%ProgramFiles%\\SecureEndpoint"',
      'set "EXE=%DIR%\\sem-agent.exe"',
      'if not exist "%DIR%" mkdir "%DIR%"',
      'echo Downloading agent...',
      `curl.exe -fSL ${curlInsecure}-o "%EXE%" "%EXEURL%"`,
      'if exist "%EXE%" goto :downloaded',
      'echo curl unavailable or failed, trying PowerShell...',
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ${trustLine}try { Invoke-WebRequest -Uri $env:EXEURL -OutFile $env:EXE -UseBasicParsing } catch { Write-Host $_; exit 1 }"`,
      ':downloaded',
      'if not exist "%EXE%" ( echo Download failed & pause & exit /b 1 )',
      'echo Enrolling this device...',
      `"%EXE%" enroll --server "%SERVER%" --token "%DEPLOY_TOKEN%"${insecure}`,
      'if %ERRORLEVEL% NEQ 0 ( echo Enrollment failed (%ERRORLEVEL%) & pause & exit /b %ERRORLEVEL% )',
      '"%EXE%" install',
      '"%EXE%" start',
      'echo.',
      'echo SecureEndpoint Agent installed. Your device is now registering for admin approval.',
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
      configured: c.enabled,
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
