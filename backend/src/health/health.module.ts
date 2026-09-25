import { Controller, Get, Inject, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { Public, SkipIpRestriction } from '../common/decorators';
import { APP_ROLE } from '../config/role';

const startedAt = new Date();
const version: string = (() => { try { return require('../../package.json').version; } catch { return '1.0.0'; } })();

async function timed<T>(fn: () => Promise<T>, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

@ApiTags('health')
@Controller('health')
@Public()
@SkipIpRestriction()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  liveness() {
    return {
      status: 'ok',
      role: APP_ROLE,
      version,
      uptimeSec: Math.round(process.uptime()),
      startedAt: startedAt.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      timed(() => this.prisma.$queryRaw`SELECT 1`),
      timed(() => this.redis.ping()),
    ]);
    const ok = database.ok && redis.ok;
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'error', checks: { database, redis }, timestamp: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
