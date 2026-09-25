import { createParamDecorator, ExecutionContext, SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Permission } from '../permissions';
import { AgentAuthGuard } from '../guards/agent-auth.guard';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const SKIP_IP_RESTRICTION_KEY = 'skipIpRestriction';
export const IS_AGENT_KEY = 'isAgent';

/** Route does not require a console JWT. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route is exempt from the IP allow-list (agents, health, CA download). */
export const SkipIpRestriction = () => SetMetadata(SKIP_IP_RESTRICTION_KEY, true);

/** All listed permissions are required. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Agent-authenticated route (Bearer agent token + X-Device-Id). */
export const AgentAuth = () =>
  applyDecorators(
    SetMetadata(IS_AGENT_KEY, true),
    SetMetadata(IS_PUBLIC_KEY, true),
    SetMetadata(SKIP_IP_RESTRICTION_KEY, true),
    UseGuards(AgentAuthGuard),
    ApiBearerAuth('agent'),
    ApiHeader({ name: 'X-Device-Id', required: true }),
  );

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});

export const CurrentDevice = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().device;
});
