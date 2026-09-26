import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleKey } from '@prisma/client';

function parseJsonMap(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const ROLE_KEYS = Object.values(RoleKey) as string[];

/** Typed accessor over validated environment variables. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  private str(key: string, fallback = ''): string {
    const v = this.config.get<string | number | boolean>(key);
    return v === undefined || v === null || v === '' ? fallback : String(v);
  }
  private num(key: string, fallback: number): number {
    const raw = this.config.get(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
  }
  private bool(key: string, fallback: boolean): boolean {
    const v = this.config.get(key);
    if (v === undefined || v === null || v === '') return fallback;
    return v === true || v === 'true';
  }

  get nodeEnv() { return this.str('NODE_ENV', 'development'); }
  get isProduction() { return this.nodeEnv === 'production'; }
  /** Swagger UI at /api/docs: on outside production; opt back in with SWAGGER_ENABLED=true. */
  get swaggerEnabled() { return this.bool('SWAGGER_ENABLED', !this.isProduction); }
  get port() { return this.num('PORT', 4000); }
  get logLevel() { return this.str('LOG_LEVEL', 'info'); }
  get databaseUrl() { return this.str('DATABASE_URL'); }
  get redisUrl() { return this.str('REDIS_URL', 'redis://localhost:6379'); }

  get jwtAccessSecret() { return this.str('JWT_ACCESS_SECRET'); }
  get jwtAccessTtl() { return this.num('JWT_ACCESS_TTL', 900); }
  get refreshTokenTtlDays() { return this.num('REFRESH_TOKEN_TTL_DAYS', 7); }
  get encryptionKey() { return this.str('ENCRYPTION_KEY'); }

  get corsOrigins(): string[] {
    return this.str('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
  }
  get webUrl() { return this.str('WEB_URL', 'http://localhost:3000').replace(/\/$/, ''); }
  get apiPublicUrl() { return this.str('API_PUBLIC_URL', 'http://localhost:4000').replace(/\/$/, ''); }
  get trustProxy(): boolean | number | string {
    const v = this.str('TRUST_PROXY', 'true');
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^\d+$/.test(v)) return Number(v);
    return v;
  }

  get rateLimitTtl() { return this.num('RATE_LIMIT_TTL', 60); }
  get rateLimitMax() { return this.num('RATE_LIMIT_MAX', 300); }
  get authRateLimitMax() { return this.num('AUTH_RATE_LIMIT_MAX', 10); }

  get mfaRequiredRoles(): RoleKey[] {
    return this.str('SECURITY_MFA_REQUIRED_ROLES')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ROLE_KEYS.includes(s)) as RoleKey[];
  }
  get sessionIdleTimeoutMinutes() { return this.num('SESSION_IDLE_TIMEOUT_MINUTES', 30); }

  get smtp() {
    return {
      host: this.str('SMTP_HOST'),
      port: this.num('SMTP_PORT', 587),
      secure: this.bool('SMTP_SECURE', false),
      user: this.str('SMTP_USER'),
      password: this.str('SMTP_PASSWORD'),
      from: this.str('SMTP_FROM') || 'SecureEndpoint Manager <no-reply@secureendpoint.local>',
    };
  }
  get smtpConfigured() { return !!this.smtp.host; }

  get twilio() {
    return {
      accountSid: this.str('TWILIO_ACCOUNT_SID'),
      authToken: this.str('TWILIO_AUTH_TOKEN'),
      fromNumber: this.str('TWILIO_FROM_NUMBER'),
      whatsappFrom: this.str('TWILIO_WHATSAPP_FROM'),
    };
  }
  get twilioSmsConfigured() {
    const t = this.twilio;
    return !!(t.accountSid && t.authToken && t.fromNumber);
  }
  get twilioWhatsappConfigured() {
    const t = this.twilio;
    return !!(t.accountSid && t.authToken && t.whatsappFrom);
  }

  get ldap() {
    return {
      url: this.str('LDAP_URL'),
      bindDn: this.str('LDAP_BIND_DN'),
      bindPassword: this.str('LDAP_BIND_PASSWORD'),
      searchBase: this.str('LDAP_SEARCH_BASE'),
      searchFilter: this.str('LDAP_SEARCH_FILTER', '(sAMAccountName={{username}})'),
      tlsRejectUnauthorized: this.bool('LDAP_TLS_REJECT_UNAUTHORIZED', true),
      defaultRole: this.str('LDAP_DEFAULT_ROLE', 'EMPLOYEE') as RoleKey,
      groupRoleMap: parseJsonMap(this.str('LDAP_GROUP_ROLE_MAP')),
    };
  }
  get ldapConfigured() {
    const l = this.ldap;
    return !!(l.url && l.searchBase);
  }

  get azureAd() {
    return {
      tenantId: this.str('AZURE_AD_TENANT_ID'),
      clientId: this.str('AZURE_AD_CLIENT_ID'),
      clientSecret: this.str('AZURE_AD_CLIENT_SECRET'),
      redirectUri: this.str('AZURE_AD_REDIRECT_URI') || `${this.apiPublicUrl}/api/v1/auth/sso/azure-ad/callback`,
      groupRoleMap: parseJsonMap(this.str('AZURE_AD_GROUP_ROLE_MAP')),
    };
  }
  get azureAdConfigured() {
    const a = this.azureAd;
    return !!(a.tenantId && a.clientId && a.clientSecret);
  }

  get oidc() {
    return {
      issuer: this.str('OIDC_ISSUER'),
      clientId: this.str('OIDC_CLIENT_ID'),
      clientSecret: this.str('OIDC_CLIENT_SECRET'),
      redirectUri: this.str('OIDC_REDIRECT_URI') || `${this.apiPublicUrl}/api/v1/auth/sso/oidc/callback`,
    };
  }
  get oidcConfigured() {
    const o = this.oidc;
    return !!(o.issuer && o.clientId);
  }

  get reportsDir() { return this.str('REPORTS_DIR', './data/reports'); }
  get caCertPath() { return this.str('CA_CERT_PATH', './data/pki/ca.crt'); }
  get caKeyPath() { return this.str('CA_KEY_PATH', './data/pki/ca.key'); }
  get agentDownloadBaseUrl() {
    return this.str('AGENT_DOWNLOAD_BASE_URL', 'http://localhost/downloads').replace(/\/$/, '');
  }
  /** Keep seeded demo devices "checking in" so a demo install does not go stale. */
  get demoActivity() { return this.bool('DEMO_ACTIVITY', this.bool('SEED_DEMO_DATA', true)); }
  get seedAdminEmail() { return this.str('SEED_ADMIN_EMAIL', 'admin@secureendpoint.local'); }
  get seedAdminPassword() { return this.str('SEED_ADMIN_PASSWORD', 'ChangeMe!Secure2026'); }
  get seedDemoData() { return this.bool('SEED_DEMO_DATA', true); }

  // ── Workforce / AI (docs/WORKFORCE.md) ──
  get screenshotsDir() { return this.str('SCREENSHOTS_DIR', './data/screenshots'); }
  get workforceTimezone() { return this.str('WORKFORCE_TIMEZONE', 'Asia/Kolkata'); }
  get anthropicApiKey() { return this.str('ANTHROPIC_API_KEY'); }
  get aiModel() { return this.str('AI_MODEL', 'claude-opus-5'); }
  get aiEffort(): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
    const v = this.str('AI_EFFORT', 'high');
    return (['low', 'medium', 'high', 'xhigh', 'max'].includes(v) ? v : 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  }
  get aiDailyRunTime() { return this.str('AI_DAILY_RUN_TIME', '20:30'); }
  get aiMaxEmployeesPerRun() { return this.num('AI_MAX_EMPLOYEES_PER_RUN', 500); }

  // ── Self-service deployment (docs/DEPLOY-SELF-ENROLL.md) ──
  get deployEnabledEnv() { return this.bool('DEPLOY_ENABLED', true); }
  get deployCompanyName() { return this.str('DEPLOY_COMPANY_NAME', 'Your Company'); }
  get deployImapHost() { return this.str('DEPLOY_IMAP_HOST'); }
  get deployImapPort() { return this.num('DEPLOY_IMAP_PORT', 993); }
  get deployImapSecure() { return this.bool('DEPLOY_IMAP_SECURE', true); }
  get deployAllowedDomains(): string[] {
    return this.str('DEPLOY_ALLOWED_DOMAINS')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
  }
  get deploySessionTtlMin() { return this.num('DEPLOY_SESSION_TTL_MIN', 20); }
  get deployDownloadBaseUrl() {
    return this.str('DEPLOY_DOWNLOAD_BASE_URL', this.agentDownloadBaseUrl).replace(/\/$/, '');
  }
}
