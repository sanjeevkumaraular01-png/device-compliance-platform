import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

export const REDIS = Symbol('REDIS');

/** Convert a redis:// or rediss:// URL into ioredis options (used by BullMQ too). */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const u = new URL(url);
  const opts: RedisOptions = {
    host: u.hostname || 'localhost',
    port: u.port ? Number(u.port) : 6379,
    maxRetriesPerRequest: null,
  };
  if (u.username) opts.username = decodeURIComponent(u.username);
  if (u.password) opts.password = decodeURIComponent(u.password);
  const db = u.pathname.replace('/', '');
  if (db) opts.db = Number(db);
  if (u.protocol === 'rediss:') opts.tls = {};
  return opts;
}

/** Small JSON cache helper over Redis. */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  constructor(@Inject(REDIS) readonly redis: Redis) {}

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
      this.logger.warn(`cache get failed: ${(e as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (e) {
      this.logger.warn(`cache set failed: ${(e as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.redis.del(...keys);
    } catch (e) {
      this.logger.warn(`cache del failed: ${(e as Error).message}`);
    }
  }

  /** Returns true if the key was set (i.e. first caller within ttl). */
  async setOnce(key: string, ttlSec: number): Promise<boolean> {
    try {
      const r = await this.redis.set(key, '1', 'EX', ttlSec, 'NX');
      return r === 'OK';
    } catch {
      return true;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const client = new Redis({ ...redisOptionsFromUrl(config.redisUrl), maxRetriesPerRequest: 3, lazyConnect: false });
        const logger = new Logger('Redis');
        client.on('error', (e) => logger.warn(`redis error: ${e.message}`));
        return client;
      },
    },
    CacheService,
  ],
  exports: [REDIS, CacheService],
})
export class RedisModule {}
