/**
 * Process role, resolved once at import time so module metadata can include or
 * exclude BullMQ processors / schedulers.
 *   api    - HTTP API only
 *   worker - BullMQ processors + schedulers (HTTP limited to health + metrics)
 *   all    - both (default)
 */
export type AppRole = 'api' | 'worker' | 'all';

const raw = (process.env.APP_ROLE ?? 'all').toLowerCase();
export const APP_ROLE: AppRole = raw === 'api' || raw === 'worker' ? raw : 'all';
export const RUN_API = APP_ROLE === 'api' || APP_ROLE === 'all';
export const RUN_WORKER = APP_ROLE === 'worker' || APP_ROLE === 'all';

/** Include providers only when this process runs workers. */
export function workerOnly<T>(...items: T[]): T[] {
  return RUN_WORKER ? items : [];
}
