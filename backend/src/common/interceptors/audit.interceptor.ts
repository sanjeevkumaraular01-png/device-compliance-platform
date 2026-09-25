import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type { Request } from 'express';
import { AuditService } from '../../audit/audit.service';
import { IS_AGENT_KEY } from '../decorators';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records rejected mutating console requests (validation/business/permission
 * errors raised inside handlers) in the audit trail with success=false.
 * Successful mutations are audited explicitly by the services with before/after.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string; email: string } }>();
    const isAgent = this.reflector.getAllAndOverride<boolean>(IS_AGENT_KEY, [context.getHandler(), context.getClass()]);
    if (!MUTATING.has(req.method) || isAgent || req.path.startsWith('/api/v1/auth/')) return next.handle();

    return next.handle().pipe(
      catchError((err) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        if (status >= 400 && status !== 404) {
          const body = err instanceof HttpException ? err.getResponse() : undefined;
          const message = typeof body === 'object' && body && 'message' in body ? (body as { message: unknown }).message : (err as Error)?.message;
          void this.audit.log({
            category: status === 403 ? 'SECURITY' : 'USER_ACTION',
            action: status === 403 ? 'request.denied' : 'request.failed',
            success: false,
            resourceType: 'HttpRequest',
            resourceId: `${req.method} ${req.route?.path ?? req.path}`.substring(0, 128),
            metadata: { method: req.method, path: req.originalUrl.split('?')[0], status, message },
          });
        }
        return throwError(() => err);
      }),
    );
  }
}
