import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import {
  AssignDeviceDto,
  CreateCommandDto,
  CreateDeviceDto,
  DevicePatchQueryDto,
  DeviceQueryDto,
  DeviceSoftwareQueryDto,
  DeviceUsbEventQueryDto,
  QuarantineDto,
  RetireQueryDto,
  TimelineQueryDto,
  UnassignDeviceDto,
  UpdateDeviceDto,
} from './devices.dto';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermissions('devices:read')
  list(@Query() q: DeviceQueryDto, @CurrentUser() user: AuthUser) {
    return this.devices.list(q, user);
  }

  @Get(':id')
  @RequirePermissions('devices:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.detail(id, user);
  }

  @Post()
  @RequirePermissions('devices:write')
  create(@Body() dto: CreateDeviceDto, @CurrentUser() user: AuthUser) {
    return this.devices.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('devices:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto, @CurrentUser() user: AuthUser) {
    return this.devices.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('devices:write')
  @HttpCode(204)
  async retire(@Param('id', ParseUUIDPipe) id: string, @Query() q: RetireQueryDto, @CurrentUser() user: AuthUser) {
    await this.devices.retire(id, !!q.hard, user);
  }

  @Post(':id/assign')
  @RequirePermissions('devices:write')
  @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDeviceDto, @CurrentUser() user: AuthUser) {
    return this.devices.assign(id, dto.userId, user, dto.notes);
  }

  @Post(':id/unassign')
  @RequirePermissions('devices:write')
  @HttpCode(200)
  unassign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UnassignDeviceDto, @CurrentUser() user: AuthUser) {
    return this.devices.unassign(id, user, dto?.notes);
  }

  @Get(':id/assignments')
  @RequirePermissions('devices:read')
  assignments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.assignments(id, user);
  }

  @Get(':id/software')
  @RequirePermissions('devices:read')
  software(@Param('id', ParseUUIDPipe) id: string, @Query() q: DeviceSoftwareQueryDto, @CurrentUser() user: AuthUser) {
    return this.devices.software(id, q, user);
  }

  @Get(':id/patches')
  @RequirePermissions('devices:read')
  patches(@Param('id', ParseUUIDPipe) id: string, @Query() q: DevicePatchQueryDto, @CurrentUser() user: AuthUser) {
    return this.devices.patches(id, q, user);
  }

  @Get(':id/usb-events')
  @RequirePermissions('devices:read')
  usbEvents(@Param('id', ParseUUIDPipe) id: string, @Query() q: DeviceUsbEventQueryDto, @CurrentUser() user: AuthUser) {
    return this.devices.usbEvents(id, q, user);
  }

  @Get(':id/compliance')
  @RequirePermissions('devices:read')
  compliance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.complianceResults(id, user);
  }

  @Get(':id/security')
  @RequirePermissions('devices:read')
  security(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.security(id, user);
  }

  @Get(':id/timeline')
  @RequirePermissions('devices:read')
  timeline(@Param('id', ParseUUIDPipe) id: string, @Query() q: TimelineQueryDto, @CurrentUser() user: AuthUser) {
    return this.devices.timeline(id, q, user);
  }

  @Post(':id/commands')
  @RequirePermissions('devices:command')
  createCommand(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCommandDto, @CurrentUser() user: AuthUser) {
    return this.devices.createCommand(id, dto, user);
  }

  @Get(':id/commands')
  @RequirePermissions('devices:read')
  listCommands(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.listCommands(id, user);
  }

  @Post(':id/quarantine')
  @RequirePermissions('devices:command')
  @HttpCode(200)
  quarantine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QuarantineDto, @CurrentUser() user: AuthUser) {
    return this.devices.quarantine(id, user, dto?.reason);
  }

  @Post(':id/release')
  @RequirePermissions('devices:command')
  @HttpCode(200)
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.release(id, user);
  }

  @Post(':id/evaluate')
  @RequirePermissions('devices:read')
  @HttpCode(200)
  evaluate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.devices.evaluate(id, user);
  }
}
