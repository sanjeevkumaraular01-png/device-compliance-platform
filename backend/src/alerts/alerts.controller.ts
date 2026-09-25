import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { AlertQueryDto, BulkAlertDto, CreateChannelDto, UpdateChannelDto } from './alerts.dto';
import { AlertsService } from './alerts.service';
import { ChannelsService } from './channels.service';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly channels: ChannelsService,
  ) {}

  // ── Channels (declared before :id routes) ──
  @Get('channels')
  @RequirePermissions('alerts:configure')
  listChannels() {
    return this.channels.list();
  }

  @Post('channels')
  @RequirePermissions('alerts:configure')
  createChannel(@Body() dto: CreateChannelDto) {
    return this.channels.create(dto);
  }

  @Get('channels/:id')
  @RequirePermissions('alerts:configure')
  async getChannel(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.serialize(await this.channels.get(id));
  }

  @Patch('channels/:id')
  @RequirePermissions('alerts:configure')
  updateChannel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChannelDto) {
    return this.channels.update(id, dto);
  }

  @Delete('channels/:id')
  @RequirePermissions('alerts:configure')
  @HttpCode(204)
  async deleteChannel(@Param('id', ParseUUIDPipe) id: string) {
    await this.channels.remove(id);
  }

  @Post('channels/:id/test')
  @RequirePermissions('alerts:configure')
  @HttpCode(200)
  testChannel(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.test(id);
  }

  // ── Alerts ──
  @Get()
  @RequirePermissions('alerts:read')
  list(@Query() q: AlertQueryDto, @CurrentUser() user: AuthUser) {
    return this.alerts.list(q, user);
  }

  @Post('bulk')
  @RequirePermissions('alerts:write')
  @HttpCode(200)
  bulk(@Body() dto: BulkAlertDto, @CurrentUser() user: AuthUser) {
    return this.alerts.bulk(dto.ids, dto.action, user);
  }

  @Get(':id')
  @RequirePermissions('alerts:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.alerts.get(id, user);
  }

  @Post(':id/acknowledge')
  @RequirePermissions('alerts:write')
  @HttpCode(200)
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.alerts.acknowledge(id, user);
  }

  @Post(':id/resolve')
  @RequirePermissions('alerts:write')
  @HttpCode(200)
  resolve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.alerts.resolve(id, user);
  }
}
