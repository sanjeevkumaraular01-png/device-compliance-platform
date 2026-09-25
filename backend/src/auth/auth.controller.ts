import { Body, Controller, Delete, Get, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from '../common/decorators';
import { clientIp } from '../common/request-context';
import type { AuthUser } from '../common/types';
import { AppConfigService } from '../config/app-config.service';
import { AuthService, ClientInfo, LoginResult } from './auth.service';
import { ChangePasswordDto, LdapLoginDto, LoginDto, MfaCodeDto, MfaVerifyDto, RefreshDto } from './dto/auth.dto';
import { LdapService } from './ldap.service';
import { SsoProviderId, SsoService } from './sso/sso.service';

const authLimit = () => Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
const authTtl = () => Number(process.env.RATE_LIMIT_TTL ?? 60) * 1000;
const AuthThrottle = () => Throttle({ default: { limit: authLimit, ttl: authTtl } });

function client(req: Request): ClientInfo {
  const ua = req.headers['user-agent'];
  return { ip: clientIp(req) ?? null, userAgent: typeof ua === 'string' ? ua : null };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly ldap: LdapService,
    private readonly sso: SsoService,
    private readonly config: AppConfigService,
  ) {}

  private sendLogin(result: LoginResult, res: Response) {
    if (result.mfaRequired) return result;
    const { mfaEnrollmentRequired, ...rest } = result;
    if (mfaEnrollmentRequired) {
      res.setHeader('X-MFA-Enrollment-Required', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-MFA-Enrollment-Required, X-Request-Id');
    }
    return rest;
  }

  @Post('login')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.sendLogin(await this.auth.login(dto.email, dto.password, client(req)), res);
  }

  @Post('ldap/login')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  async ldapLogin(@Body() dto: LdapLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const info = client(req);
    const identity = await this.ldap.authenticate(dto.username, dto.password).catch(async (e) => {
      await this.auth.recordLogin(dto.username, 'LDAP', false, info, null, 'ldap_failed').catch(() => undefined);
      throw e;
    });
    const user = await this.auth.provisionExternalUser(identity);
    return this.sendLogin(await this.auth.completePrimaryAuth(user, identity.provider, info), res);
  }

  @Get('sso/providers')
  @Public()
  providers() {
    return this.sso.providers();
  }

  /** Which sign-in methods are configured, so the login page hides the rest. */
  @Get('methods')
  @Public()
  methods() {
    return { local: true, ldap: this.ldap.enabled, sso: this.sso.providers() };
  }

  @Get('sso/:provider/login')
  @Public()
  @AuthThrottle()
  async ssoLogin(@Param('provider') provider: string, @Res() res: Response) {
    const id = this.parseProvider(provider);
    res.redirect(302, await this.sso.authorizationUrl(id));
  }

  @Get('sso/:provider/callback')
  @Public()
  @AuthThrottle()
  async ssoCallback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const target = `${this.config.webUrl}/auth/callback`;
    try {
      const id = this.parseProvider(provider);
      const identity = await this.sso.handleCallback(id, query);
      const user = await this.auth.provisionExternalUser(identity);
      const result = await this.auth.completePrimaryAuth(user, identity.provider, client(req));
      if (result.mfaRequired) {
        return res.redirect(302, `${target}#mfaToken=${encodeURIComponent(result.mfaToken)}`);
      }
      const frag = new URLSearchParams({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: String(result.expiresIn),
        ...(result.mfaEnrollmentRequired ? { mfaEnrollmentRequired: 'true' } : {}),
      });
      return res.redirect(302, `${target}#${frag.toString()}`);
    } catch (e) {
      this.logger.warn(`SSO callback failed: ${(e as Error).message}`);
      return res.redirect(302, `${target}#error=${encodeURIComponent((e as Error).message || 'sso_failed')}`);
    }
  }

  private parseProvider(p: string): SsoProviderId {
    if (p === 'azure-ad' || p === 'oidc') return p;
    throw new NotFoundException('Unknown SSO provider');
  }

  @Post('mfa/verify')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  verifyMfa(@Body() dto: MfaVerifyDto, @Req() req: Request) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code, client(req));
  }

  @Post('refresh')
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, client(req));
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @AuthThrottle()
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @Post('mfa/setup')
  @ApiBearerAuth()
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user);
  }

  @Post('mfa/enable')
  @ApiBearerAuth()
  @AuthThrottle()
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.auth.mfaEnable(user, dto.code);
  }

  @Post('mfa/disable')
  @ApiBearerAuth()
  @AuthThrottle()
  @HttpCode(204)
  async mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    await this.auth.mfaDisable(user, dto.code);
  }

  @Get('sessions')
  @ApiBearerAuth()
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user, id);
  }

  @Delete('sessions')
  @ApiBearerAuth()
  @HttpCode(204)
  async revokeOthers(@CurrentUser() user: AuthUser) {
    await this.auth.revokeOtherSessions(user);
  }
}
