import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators';

/** Global console authentication guard; bypassed by `@Public()` / `@AgentAuth()`. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    if (err) throw err instanceof Error ? err : new UnauthorizedException();
    if (!user) {
      const msg =
        info instanceof Error
          ? info.name === 'TokenExpiredError'
            ? 'Access token expired'
            : info.message === 'No auth token'
              ? 'Authentication required'
              : 'Invalid access token'
          : 'Authentication required';
      throw new UnauthorizedException(msg);
    }
    return user;
  }
}
