import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import {
  ApproveUsbRequestDto,
  CreateUsbRequestDto,
  CreateUsbWhitelistDto,
  DenyUsbRequestDto,
  UpdateUsbDeviceDto,
  UsbDeviceQueryDto,
  UsbEventQueryDto,
  UsbRequestQueryDto,
  UsbStatsQueryDto,
} from './usb.dto';
import { UsbService } from './usb.service';

@ApiTags('usb')
@ApiBearerAuth()
@Controller('usb')
export class UsbController {
  constructor(private readonly usb: UsbService) {}

  @Get('devices')
  @RequirePermissions('usb:read')
  listDevices(@Query() q: UsbDeviceQueryDto) {
    return this.usb.listDevices(q);
  }

  @Post('devices')
  @RequirePermissions('usb:write')
  addDevice(@Body() dto: CreateUsbWhitelistDto, @CurrentUser() user: AuthUser) {
    return this.usb.addToWhitelist(dto, user);
  }

  @Patch('devices/:id')
  @RequirePermissions('usb:write')
  updateDevice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUsbDeviceDto, @CurrentUser() user: AuthUser) {
    return this.usb.updateDevice(id, dto, user);
  }

  @Delete('devices/:id')
  @RequirePermissions('usb:write')
  @HttpCode(204)
  async removeDevice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.usb.removeFromWhitelist(id, user);
  }

  @Get('events')
  @RequirePermissions('usb:read')
  events(@Query() q: UsbEventQueryDto, @CurrentUser() user: AuthUser) {
    return this.usb.events(q, user);
  }

  @Get('requests')
  listRequests(@Query() q: UsbRequestQueryDto, @CurrentUser() user: AuthUser) {
    // usb:read (reviewers/auditors) or usb:request (requesters, scoped to their own)
    if (!user.permissions.includes('usb:read') && !user.permissions.includes('usb:request')) {
      throw new ForbiddenException('Missing permission: usb:read');
    }
    return this.usb.listRequests(q, user);
  }

  @Post('requests')
  @RequirePermissions('usb:request')
  createRequest(@Body() dto: CreateUsbRequestDto, @CurrentUser() user: AuthUser) {
    return this.usb.createRequest(dto, user);
  }

  @Post('requests/:id/approve')
  @RequirePermissions('usb:approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveUsbRequestDto, @CurrentUser() user: AuthUser) {
    return this.usb.approve(id, dto, user);
  }

  @Post('requests/:id/deny')
  @RequirePermissions('usb:approve')
  @HttpCode(200)
  deny(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DenyUsbRequestDto, @CurrentUser() user: AuthUser) {
    return this.usb.deny(id, dto?.note, user);
  }

  @Post('requests/:id/revoke')
  @RequirePermissions('usb:approve')
  @HttpCode(200)
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.usb.revoke(id, user);
  }

  @Get('stats')
  @RequirePermissions('usb:read')
  stats(@Query() q: UsbStatsQueryDto, @CurrentUser() user: AuthUser) {
    return this.usb.stats(q.days ?? 14, user);
  }
}
