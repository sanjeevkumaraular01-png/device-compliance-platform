import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { isValidCidr, parseCidr, ParsedCidr } from '../common/utils/cidr';

const CACHE_MS = 30_000;
const ROLE_KEYS = Object.values(RoleKey) as string[];

/** Known system settings with validators and defaults. */
const SETTING_SPECS: Record<string, { validate: (v: unknown) => boolean; hint: string }> = {
  sessionTimeoutMinutes: { validate: (v) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 1440, hint: 'integer 5-1440' },
  mfaRequiredRoles: {
    validate: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && ROLE_KEYS.includes(x)),
    hint: 'array of role keys',
  },
  deviceInactiveAfterHours: { validate: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 720, hint: 'integer 1-720' },
  onlineThresholdMinutes: { validate: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1440, hint: 'integer 1-1440' },
  auditRetentionDays: { validate: (v) => Number.isInteger(v) && (v as number) >= 30, hint: 'integer >= 30' },
  reportRetentionDays: { validate: (v) => Number.isInteger(v) && (v as number) >= 1, hint: 'integer >= 1' },
  companyName: { validate: (v) => typeof v === 'string' && v.length <= 200, hint: 'string' },
  supportEmail: { validate: (v) => typeof v === 'string' && v.length <= 200, hint: 'string' },
  passwordExpiryDays: { validate: (v) => Number.isInteger(v) && (v as number) >= 0, hint: 'integer >= 0 (0 = never)' },
  usbRequestMaxHours: { validate: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 72, hint: 'integer 1-72' },
  // Workforce (docs/WORKFORCE.md)
  aiEnabled: { validate: (v) => typeof v === 'boolean', hint: 'boolean' },
  workforceTimezone: { validate: (v) => typeof v === 'string' && isValidTimeZone(v), hint: 'IANA time zone, e.g. Asia/Kolkata' },
  taskWebhookToken: {
    validate: (v) => v === '' || (typeof v === 'string' && v.length >= 24 && v.length <= 200),
    hint: 'string of 24-200 characters (empty disables the task webhook)',
  },
};

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class SettingsService {
  private cache: { at: number; values: Record<string, unknown> } | null = null;
  private ipCache: { at: number; rules: ParsedCidr[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  defaults(): Record<string, unknown> {
    return {
      sessionTimeoutMinutes: this.config.sessionIdleTimeoutMinutes,
      mfaRequiredRoles: this.config.mfaRequiredRoles,
      deviceInactiveAfterHours: 24,
      onlineThresholdMinutes: 15,
      auditRetentionDays: 365,
      reportRetentionDays: 30,
      companyName: 'SecureEndpoint Manager',
      supportEmail: '',
      passwordExpiryDays: 0,
      usbRequestMaxHours: 72,
      aiEnabled: true,
      workforceTimezone: this.config.workforceTimezone,
      taskWebhookToken: '',
    };
  }

  async getAll(): Promise<Record<string, unknown>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.values;
    const rows = await this.prisma.systemSetting.findMany();
    const values: Record<string, unknown> = { ...this.defaults() };
    for (const r of rows) values[r.key] = r.value;
    this.cache = { at: Date.now(), values };
    return values;
  }

  async get<T = unknown>(key: string): Promise<T> {
    return (await this.getAll())[key] as T;
  }

  async sessionTimeoutMinutes(): Promise<number> {
    const v = await this.get<number>('sessionTimeoutMinutes');
    return Number.isInteger(v) && v > 0 ? v : this.config.sessionIdleTimeoutMinutes;
  }

  async mfaRequiredRoles(): Promise<RoleKey[]> {
    const v = await this.get<RoleKey[]>('mfaRequiredRoles');
    return Array.isArray(v) ? v : this.config.mfaRequiredRoles;
  }

  async patch(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Body must be an object');
    const errors: string[] = [];
    for (const [k, v] of Object.entries(body)) {
      const spec = SETTING_SPECS[k];
      if (!spec) errors.push(`Unknown setting "${k}"`);
      else if (!spec.validate(v)) errors.push(`${k} must be ${spec.hint}`);
    }
    if (errors.length) throw new BadRequestException(errors);
    const before = await this.getAll();
    await this.prisma.$transaction(
      Object.entries(body).map(([key, value]) =>
        this.prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        }),
      ),
    );
    this.cache = null;
    const after = await this.getAll();
    await this.audit.log({
      category: 'SYSTEM',
      action: 'settings.update',
      resourceType: 'SystemSetting',
      before: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]])),
      after: body,
    });
    return after;
  }

  // ── IP restrictions ──
  listIpRestrictions() {
    return this.prisma.ipRestriction.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async addIpRestriction(cidr: string, description?: string) {
    const normalized = cidr.trim();
    if (!isValidCidr(normalized)) throw new BadRequestException('cidr must be a valid IPv4/IPv6 CIDR');
    const exists = await this.prisma.ipRestriction.findUnique({ where: { cidr: normalized } });
    if (exists) throw new ConflictException('CIDR already exists');
    const row = await this.prisma.ipRestriction.create({ data: { cidr: normalized, description } });
    this.ipCache = null;
    await this.audit.log({ category: 'SECURITY', action: 'ip_restriction.create', resourceType: 'IpRestriction', resourceId: row.id, after: row });
    return row;
  }

  async removeIpRestriction(id: string) {
    const row = await this.prisma.ipRestriction.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('IP restriction not found');
    await this.prisma.ipRestriction.delete({ where: { id } });
    this.ipCache = null;
    await this.audit.log({ category: 'SECURITY', action: 'ip_restriction.delete', resourceType: 'IpRestriction', resourceId: id, before: row });
  }

  /** Enabled CIDR rules, cached in memory for 30 seconds. */
  async ipRules(): Promise<ParsedCidr[]> {
    if (this.ipCache && Date.now() - this.ipCache.at < CACHE_MS) return this.ipCache.rules;
    const rows = await this.prisma.ipRestriction.findMany({ where: { enabled: true } });
    const rules = rows.map((r) => parseCidr(r.cidr)).filter((x): x is ParsedCidr => !!x);
    this.ipCache = { at: Date.now(), rules };
    return rules;
  }
}
