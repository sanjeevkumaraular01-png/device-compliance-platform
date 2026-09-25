import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { clientIp, RequestContext } from '../request-context';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Assigns a request id (reusing a sane inbound X-Request-Id), echoes it back and
 * opens the AsyncLocalStorage request context used by audit logging.
 * Mounted as plain Express middleware in main.ts so it wraps everything.
 */
export function requestContextMiddleware(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && SAFE_ID.test(inbound) ? inbound : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const ua = req.headers['user-agent'];
  RequestContext.run(
    { requestId: id, ip: clientIp(req), userAgent: typeof ua === 'string' ? ua.substring(0, 512) : undefined },
    () => next(),
  );
}
