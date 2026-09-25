import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../config/app-config.service';
import { AuthContextService } from '../auth-context.service';
import { SettingsService } from '../../settings/settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContext } from '../../common/request-context';
import type { AuthUser } from '../../common/types';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: string;
  typ: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly ctx: AuthContextService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtAccessSecret,
      algorithms: ['HS256'],
      issuer: 'secureendpoint-manager',
      passReqToCallback: true,
    });
  }

  async validate(_req: Request, payload: AccessTokenPayload): Promise<AuthUser> {
    if (payload?.typ !== 'access' || !payload.sub || !payload.sid) {
      throw new UnauthorizedException('Invalid access token');
    }
    const session = await this.ctx.getSession(payload.sid);
    if (!session || session.userId !== payload.sub || session.revoked) {
      throw new UnauthorizedException('Session has been revoked');
    }
    const now = Date.now();
    if (new Date(session.expiresAt).getTime() < now) throw new UnauthorizedException('Session expired');
    const idleMin = await this.settings.sessionTimeoutMinutes();
    if (now - new Date(session.lastSeenAt).getTime() > idleMin * 60_000) {
      await this.prisma.session
        .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      await this.ctx.invalidateSessions(session.id);
      throw new UnauthorizedException('Session expired due to inactivity');
    }
    const user = await this.ctx.getUserContext(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');
    await this.ctx.touchSession(session);
    RequestContext.set({ actorType: 'USER', actorId: user.id, actorName: user.email });
    return this.ctx.toAuthUser(user, session.id);
  }
}
