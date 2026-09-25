import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser, Public, RequirePermissions, SkipIpRestriction } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { CaService } from './ca.service';
import { CreateEnrollmentTokenDto, EnrollmentListQueryDto, InstallCommandQueryDto, RejectDeviceDto } from './enrollment.dto';
import { EnrollmentService } from './enrollment.service';

@ApiTags('enrollment')
@ApiBearerAuth()
@Controller('enrollment')
export class EnrollmentController {
  constructor(
    private readonly enrollment: EnrollmentService,
    private readonly ca: CaService,
  ) {}

  @Get('ca.pem')
  @Public()
  @SkipIpRestriction()
  @SkipThrottle()
  @Header('Content-Type', 'application/x-pem-file')
  @Header('Content-Disposition', 'attachment; filename="secureendpoint-ca.pem"')
  caPem() {
    return this.ca.caCertificatePem;
  }

  @Get('tokens')
  @RequirePermissions('enrollment:manage')
  listTokens(@Query() q: EnrollmentListQueryDto) {
    return this.enrollment.listTokens(q);
  }

  @Post('tokens')
  @RequirePermissions('enrollment:manage')
  createToken(@Body() dto: CreateEnrollmentTokenDto, @CurrentUser() user: AuthUser) {
    return this.enrollment.createToken(dto, user);
  }

  @Delete('tokens/:id')
  @RequirePermissions('enrollment:manage')
  revokeToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.revokeToken(id);
  }

  @Get('install-command')
  @RequirePermissions('enrollment:manage')
  installCommand(@Query() q: InstallCommandQueryDto) {
    return this.enrollment.installCommand(q.tokenId, q.platform, q.token);
  }

  @Get('pending')
  @RequirePermissions('enrollment:manage')
  pending(@Query() q: PaginationQueryDto) {
    return this.enrollment.pending(q);
  }

  @Post('devices/:id/approve')
  @RequirePermissions('enrollment:manage')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.approve(id);
  }

  @Post('devices/:id/reject')
  @RequirePermissions('enrollment:manage')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDeviceDto) {
    return this.enrollment.reject(id, dto?.reason);
  }
}
