import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'http';

/** Produces the contract error shape: { statusCode, error, message, path, timestamp, requestId }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    if (!res || typeof res.status !== 'function') return;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object' && 'message' in body) {
        message = (body as { message: string | string[] }).message;
      } else message = exception.message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const target = (exception.meta?.target as string[] | string | undefined) ?? '';
          message = `Unique constraint violation${target ? ` on ${Array.isArray(target) ? target.join(', ') : target}` : ''}`;
          break;
        }
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Resource not found';
          break;
        case 'P2003':
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = 'Referenced resource does not exist';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Database error';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid request parameters';
    } else if (
      exception &&
      typeof exception === 'object' &&
      (exception as { type?: string }).type === 'entity.parse.failed'
    ) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Malformed JSON body';
    } else if (exception && typeof exception === 'object' && (exception as { status?: number }).status === 413) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Request body too large';
    }

    if (status >= 500) {
      this.logger.error(
        `${req?.method} ${req?.originalUrl} -> ${status}: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }

    if (res.headersSent) return;
    res.status(status).json({
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      path: req?.originalUrl?.split('?')[0] ?? '',
      timestamp: new Date().toISOString(),
      requestId: req?.id ?? (res.getHeader('x-request-id') as string | undefined) ?? null,
    });
  }
}
