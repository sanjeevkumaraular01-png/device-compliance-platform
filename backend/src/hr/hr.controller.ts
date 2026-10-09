import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { clientIp } from '../common/request-context';
import type { AuthUser } from '../common/types';
import { AcknowledgeDto, DirectoryQueryDto, OffboardDto, OnboardDto, PublishNoticeDto } from './hr.dto';
import { HrService } from './hr.service';
import { NoticeService } from './notice.service';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class HrController {
  constructor(
    private readonly hr: HrService,
    private readonly notices: NoticeService,
  ) {}

  @Get('directory')
  @RequirePermissions('users:read')
  directory(@Query() q: DirectoryQueryDto, @CurrentUser() user: AuthUser) {
    return this.hr.directory(q, user);
  }

  @Get('employees/:id/acknowledgements')
  @RequirePermissions('users:read')
  acknowledgements(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.hr.acknowledgementsFor(id, user);
  }

  @Post('employees/:id/onboard')
  @RequirePermissions('users:write')
  @HttpCode(200)
  onboard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OnboardDto, @CurrentUser() user: AuthUser) {
    return this.hr.onboard(id, dto, user);
  }

  @Post('employees/:id/offboard')
  @RequirePermissions('users:write')
  @HttpCode(200)
  offboard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OffboardDto, @CurrentUser() user: AuthUser) {
    return this.hr.offboard(id, dto, user);
  }

  /** Current notice — any signed-in user may read it. */
  @Get('notice')
  async notice() {
    return { notice: await this.notices.current() };
  }

  @Get('notice/history')
  @RequirePermissions('users:read')
  history() {
    return this.notices.history();
  }

  @Put('notice')
  @RequirePermissions('settings:write')
  publish(@Body() dto: PublishNoticeDto, @CurrentUser() user: AuthUser) {
    return this.notices.publish(dto, user);
  }

  /** A signed-in user acknowledges the current notice for themselves. */
  @Post('notice/acknowledge')
  @HttpCode(200)
  acknowledge(@Body() dto: AcknowledgeDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.notices.acknowledge(user.id, dto, 'WEB', clientIp(req) ?? null, req.headers['user-agent'] ?? null);
  }
}
