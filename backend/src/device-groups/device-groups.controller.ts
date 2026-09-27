import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { CreateDeviceGroupDto, GroupMembersDto, UpdateDeviceGroupDto } from './device-groups.dto';
import { DeviceGroupsService } from './device-groups.service';

@ApiTags('device-groups')
@ApiBearerAuth()
@Controller('device-groups')
export class DeviceGroupsController {
  constructor(private readonly groups: DeviceGroupsService) {}

  @Get()
  @RequirePermissions('devices:read')
  list(@Query() q: PaginationQueryDto) {
    return this.groups.list(q);
  }

  @Get(':id')
  @RequirePermissions('devices:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.get(id);
  }

  @Post()
  @RequirePermissions('devices:write')
  create(@Body() dto: CreateDeviceGroupDto, @CurrentUser() user: AuthUser) {
    return this.groups.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('devices:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceGroupDto, @CurrentUser() user: AuthUser) {
    return this.groups.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('devices:write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.groups.remove(id);
  }

  @Post(':id/devices')
  @RequirePermissions('devices:write')
  @HttpCode(200)
  addDevices(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupMembersDto, @CurrentUser() user: AuthUser) {
    return this.groups.addDevices(id, dto, user);
  }

  @Delete(':id/devices')
  @RequirePermissions('devices:write')
  @HttpCode(200)
  removeDevices(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupMembersDto, @CurrentUser() user: AuthUser) {
    return this.groups.removeDevices(id, dto, user);
  }
}
