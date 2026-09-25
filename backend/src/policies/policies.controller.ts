import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { AssignPolicyDto, CreatePolicyDto, UpdatePolicyDto } from './policies.dto';
import { PoliciesService } from './policies.service';

@ApiTags('policies')
@ApiBearerAuth()
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  @RequirePermissions('policies:read')
  list(@Query() q: PaginationQueryDto) {
    return this.policies.list(q);
  }

  @Get('effective/:deviceId')
  @RequirePermissions('policies:read')
  effective(@Param('deviceId', ParseUUIDPipe) deviceId: string, @CurrentUser() user: AuthUser) {
    return this.policies.effective(deviceId, user);
  }

  @Get(':id')
  @RequirePermissions('policies:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.policies.get(id);
  }

  @Get(':id/devices')
  @RequirePermissions('policies:read')
  devices(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.policies.devices(id, q);
  }

  @Post()
  @RequirePermissions('policies:write')
  create(@Body() dto: CreatePolicyDto, @CurrentUser() user: AuthUser) {
    return this.policies.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('policies:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePolicyDto, @CurrentUser() user: AuthUser) {
    return this.policies.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('policies:write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.policies.remove(id);
  }

  @Post(':id/assign')
  @RequirePermissions('policies:write')
  @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignPolicyDto, @CurrentUser() user: AuthUser) {
    return this.policies.assign(id, dto, user);
  }
}
