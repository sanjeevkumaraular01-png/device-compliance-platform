import { AsyncLocalStorage } from 'async_hooks';
import type { Request } from 'express';

export interface RequestContextStore {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  actorType?: 'USER' | 'DEVICE' | 'SYSTEM';
  actorId?: string;
  actorName?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  set(patch: Partial<RequestContextStore>): void {
    const s = storage.getStore();
    if (s) Object.assign(s, patch);
  },
};

export function clientIp(req: Request): string | undefined {
  const ip = req.ip || req.socket?.remoteAddress;
  if (!ip) return undefined;
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}
