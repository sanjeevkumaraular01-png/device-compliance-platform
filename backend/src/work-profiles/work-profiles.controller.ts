import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { AssignWorkProfileDto, CreateWorkProfileDto, UpdateWorkProfileDto } from './work-profiles.dto';
import { WorkProfilesService } from './work-profiles.service';

@ApiTags('work-profiles')
@ApiBearerAuth()
@Controller('work-profiles')
export class WorkProfilesController {
  constructor(private readonly profiles: WorkProfilesService) {}

  @Get()
  @RequirePermissions('policies:read')
  list(@Query() q: PaginationQueryDto) {
    return this.profiles.list(q);
  }

  @Get(':id')
  @RequirePermissions('policies:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.get(id);
  }

  @Post()
  @RequirePermissions('policies:write')
  create(@Body() dto: CreateWorkProfileDto, @CurrentUser() user: AuthUser) {
    return this.profiles.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('policies:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkProfileDto, @CurrentUser() user: AuthUser) {
    return this.profiles.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('policies:write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.profiles.remove(id);
  }

  @Post(':id/assign')
  @RequirePermissions('users:write')
  @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignWorkProfileDto, @CurrentUser() user: AuthUser) {
    return this.profiles.assignUsers(id, dto, user);
  }
}
