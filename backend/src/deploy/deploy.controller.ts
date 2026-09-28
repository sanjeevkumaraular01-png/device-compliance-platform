import { Body, Controller, Get, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public, RequirePermissions, SkipIpRestriction } from '../common/decorators';
import { clientIp } from '../common/request-context';
import type { AuthUser } from '../common/types';
import { DeployService } from './deploy.service';
import { DeploySessionDto, DeploySettingsDto } from './deploy.dto';

const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
const authTtl = Number(process.env.RATE_LIMIT_TTL ?? 60) * 1000;

/** Self-service device enrollment (docs/DEPLOY-SELF-ENROLL.md). Public pages are
 *  exempt from console IP restrictions and rate-limited like /auth. */
@ApiTags('deploy')
@Controller('deploy')
export class DeployController {
  constructor(private readonly deploy: DeployService) {}

  @Get('config')
  @Public()
  @SkipIpRestriction()
  config() {
    return this.deploy.publicConfig();
  }

  @Post('session')
  @Public()
  @SkipIpRestriction()
  @Throttle({ default: { limit: authLimit, ttl: authTtl } })
  session(@Body() dto: DeploySessionDto, @Req() req: Request) {
    return this.deploy.createSession(dto.employeeCode, clientIp(req) ?? null);
  }

  @Get('status')
  @Public()
  @SkipIpRestriction()
  @SkipThrottle()
  status(@Query('token') token: string) {
    return this.deploy.status(token ?? '');
  }

  @Get('setup.cmd')
  @Public()
  @SkipIpRestriction()
  async setupCmd(@Query('token') token: string, @Res() res: Response) {
    const script = await this.deploy.setupCmd(token ?? '');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="SecureEndpoint-Setup.cmd"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  }

  // ── admin ──
  @Get('settings')
  @RequirePermissions('settings:write')
  getSettings() {
    return this.deploy.getSettings();
  }

  @Put('settings')
  @RequirePermissions('settings:write')
  updateSettings(@Body() dto: DeploySettingsDto, @CurrentUser() user: AuthUser) {
    return this.deploy.updateSettings(dto, user.id);
  }
}
