import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_IP_RESTRICTION_KEY } from '../common/decorators';
import { clientIp } from '../common/request-context';
import { ipInCidr } from '../common/utils/cidr';
import { SettingsService } from './settings.service';

/**
 * When at least one enabled IP restriction exists, console API requests from
 * other IPs are rejected with 403. Agent, health and metrics routes are exempt.
 */
@Injectable()
export class IpRestrictionGuard implements CanActivate {
  private readonly logger = new Logger(IpRestrictionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_IP_RESTRICTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const rules = await this.settings.ipRules();
    if (!rules.length) return true;
    const ip = clientIp(context.switchToHttp().getRequest());
    if (ip && rules.some((r) => ipInCidr(ip, r))) return true;
    this.logger.warn(`Blocked console request from ${ip ?? 'unknown IP'} by IP restriction`);
    throw new ForbiddenException('Access from your IP address is not allowed');
  }
}
