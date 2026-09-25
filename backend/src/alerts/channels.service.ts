import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertChannel, AlertChannelType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { ChannelConfig, NotifierService } from './notifier.service';
import { CreateChannelDto, UpdateChannelDto } from './alerts.dto';

const MASK = '****';

function maskString(key: string, value: string): string {
  if (/secret|token|password|key/i.test(key)) return MASK;
  if (/url/i.test(key)) {
    try {
      const u = new URL(value);
      return `${u.protocol}//${u.host}/${MASK}`;
    } catch {
      return MASK;
    }
  }
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local.substring(0, 2)}${MASK}@${domain}`;
  }
  if (/^\+?\d{6,}$/.test(value)) return `${value.substring(0, 3)}${MASK}${value.substring(value.length - 2)}`;
  return value.length > 4 ? `${value.substring(0, 2)}${MASK}` : MASK;
}

export function maskConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg ?? {})) {
    if (typeof v === 'string') out[k] = k === 'provider' ? v : maskString(k, v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? maskString(k, x) : x));
    else out[k] = v;
  }
  return out;
}

/** Merge an updated config over the stored one, keeping values the client sent back masked. */
export function mergeConfig(stored: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === 'string' && v.includes(MASK) && k in stored) out[k] = stored[k];
    if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x.includes(MASK)) && Array.isArray(stored[k])) {
      const prev = stored[k] as unknown[];
      out[k] = v.map((x, i) => (typeof x === 'string' && x.includes(MASK) ? prev[i] : x)).filter((x) => x !== undefined);
    }
  }
  return out;
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifier: NotifierService,
    private readonly config: AppConfigService,
  ) {}

  decryptConfig(ch: AlertChannel): ChannelConfig {
    try {
      return this.crypto.decryptJson<ChannelConfig>(ch.configEnc) ?? {};
    } catch {
      return {};
    }
  }

  serialize(ch: AlertChannel) {
    const { configEnc: _enc, ...rest } = ch;
    return { ...rest, config: maskConfig(this.decryptConfig(ch) as Record<string, unknown>) };
  }

  private validate(type: AlertChannelType, cfg: Record<string, unknown>) {
    const errors = this.notifier.validateConfig(type, cfg as ChannelConfig);
    if (errors.length) throw new BadRequestException(errors);
  }

  async list() {
    const rows = await this.prisma.alertChannel.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.serialize(r));
  }

  async get(id: string) {
    const ch = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!ch) throw new NotFoundException('Channel not found');
    return ch;
  }

  async create(dto: CreateChannelDto) {
    this.validate(dto.type, dto.config);
    if (await this.prisma.alertChannel.findUnique({ where: { name: dto.name } })) throw new ConflictException('Channel name already exists');
    const ch = await this.prisma.alertChannel.create({
      data: {
        name: dto.name,
        type: dto.type,
        configEnc: this.crypto.encryptJson(dto.config),
        minSeverity: dto.minSeverity ?? 'HIGH',
        categories: dto.categories ?? [],
        enabled: dto.enabled ?? true,
      },
    });
    const out = this.serialize(ch);
    await this.audit.log({ category: 'SYSTEM', action: 'alert_channel.create', resourceType: 'AlertChannel', resourceId: ch.id, after: out });
    return out;
  }

  async update(id: string, dto: UpdateChannelDto) {
    const existing = await this.get(id);
    const before = this.serialize(existing);
    const type = dto.type ?? existing.type;
    const data: Prisma.AlertChannelUpdateInput = {};
    if (dto.config !== undefined) {
      const merged = mergeConfig(this.decryptConfig(existing) as Record<string, unknown>, dto.config);
      this.validate(type, merged);
      data.configEnc = this.crypto.encryptJson(merged);
    } else if (dto.type && dto.type !== existing.type) {
      throw new BadRequestException('config is required when changing the channel type');
    }
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.minSeverity !== undefined) data.minSeverity = dto.minSeverity;
    if (dto.categories !== undefined) data.categories = dto.categories;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    const ch = await this.prisma.alertChannel.update({ where: { id }, data });
    const out = this.serialize(ch);
    await this.audit.log({ category: 'SYSTEM', action: 'alert_channel.update', resourceType: 'AlertChannel', resourceId: id, before, after: out });
    return out;
  }

  async remove(id: string) {
    const existing = await this.get(id);
    await this.prisma.alertChannel.delete({ where: { id } });
    await this.audit.log({ category: 'SYSTEM', action: 'alert_channel.delete', resourceType: 'AlertChannel', resourceId: id, before: this.serialize(existing) });
  }

  async test(id: string) {
    const ch = await this.get(id);
    this.notifier.assertAvailable(ch.type);
    const cfg = this.decryptConfig(ch);
    const errors = this.notifier.validateConfig(ch.type, cfg);
    if (errors.length) throw new BadRequestException(errors);
    let ok = true;
    let error: string | null = null;
    try {
      await this.notifier.send(ch.type, cfg, {
        title: 'Test notification',
        message: `This is a test message from SecureEndpoint Manager for channel "${ch.name}".`,
        severity: 'INFO',
        category: 'SYSTEM',
        url: this.config.webUrl,
        occurredAt: new Date().toISOString(),
      });
    } catch (e) {
      ok = false;
      error = (e as Error).message;
    }
    await this.audit.log({ category: 'SYSTEM', action: 'alert_channel.test', resourceType: 'AlertChannel', resourceId: id, success: ok, metadata: error ? { error } : undefined });
    return { success: ok, error };
  }
}
