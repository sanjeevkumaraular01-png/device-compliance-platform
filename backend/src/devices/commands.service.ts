import { Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { CommandType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEFAULT_TTL_HOURS = 72;

/** Creates and tracks device commands delivered on agent heartbeat. */
@Injectable()
export class CommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    deviceId: string,
    type: CommandType,
    payload: Record<string, unknown> = {},
    opts: { createdById?: string | null; ttlHours?: number; audit?: boolean } = {},
  ) {
    const cmd = await this.prisma.deviceCommand.create({
      data: {
        deviceId,
        type,
        payload: payload as Prisma.InputJsonValue,
        createdById: opts.createdById ?? null,
        expiresAt: new Date(Date.now() + (opts.ttlHours ?? DEFAULT_TTL_HOURS) * 3_600_000),
      },
    });
    if (opts.audit !== false) {
      await this.audit.log({
        category: 'DEVICE_CHANGE',
        action: 'device.command.create',
        resourceType: 'DeviceCommand',
        resourceId: cmd.id,
        deviceId,
        after: { type, payload },
      });
    }
    return cmd;
  }

  /** Queue the same command for many devices; skips duplicates still pending. */
  async createMany(
    deviceIds: string[],
    type: CommandType,
    payload: Record<string, unknown> = {},
    opts: { createdById?: string | null; ttlHours?: number; dedupePending?: boolean } = {},
  ): Promise<number> {
    let ids = [...new Set(deviceIds)];
    if (!ids.length) return 0;
    if (opts.dedupePending) {
      const pending = await this.prisma.deviceCommand.findMany({
        where: { deviceId: { in: ids }, type, status: 'PENDING', expiresAt: { gt: new Date() } },
        select: { deviceId: true },
      });
      const skip = new Set(pending.map((p) => p.deviceId));
      ids = ids.filter((id) => !skip.has(id));
    }
    if (!ids.length) return 0;
    const expiresAt = new Date(Date.now() + (opts.ttlHours ?? DEFAULT_TTL_HOURS) * 3_600_000);
    const res = await this.prisma.deviceCommand.createMany({
      data: ids.map((deviceId) => ({
        deviceId,
        type,
        payload: payload as Prisma.InputJsonValue,
        createdById: opts.createdById ?? null,
        expiresAt,
      })),
    });
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.command.bulk_create',
      resourceType: 'DeviceCommand',
      after: { type, payload, deviceCount: res.count },
      metadata: { deviceIds: ids.slice(0, 200) },
    });
    return res.count;
  }

  list(deviceId: string) {
    return this.prisma.deviceCommand.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async get(id: string) {
    const c = await this.prisma.deviceCommand.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Command not found');
    return c;
  }
}

@Global()
@Module({
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
