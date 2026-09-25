import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import {
  CatalogQueryDto,
  CreateBlacklistDto,
  CreateWhitelistDto,
  InventoryQueryDto,
  UnauthorizedQueryDto,
  UninstallDto,
  UpdateBlacklistDto,
  UpdateWhitelistDto,
} from './software.dto';
import { SoftwareService } from './software.service';

@ApiTags('software')
@ApiBearerAuth()
@Controller('software')
export class SoftwareController {
  constructor(private readonly software: SoftwareService) {}

  @Get('inventory')
  @RequirePermissions('software:read')
  inventory(@Query() q: InventoryQueryDto, @CurrentUser() user: AuthUser) {
    return this.software.inventory(q, user);
  }

  @Get('inventory/:name/devices')
  @RequirePermissions('software:read')
  devicesWith(@Param('name') name: string, @Query() q: InventoryQueryDto, @CurrentUser() user: AuthUser) {
    return this.software.devicesWith(name, q, user);
  }

  @Get('unauthorized')
  @RequirePermissions('software:read')
  unauthorized(@Query() q: UnauthorizedQueryDto, @CurrentUser() user: AuthUser) {
    return this.software.unauthorized(q, user);
  }

  @Get('whitelist')
  @RequirePermissions('software:read')
  listWhitelist(@Query() q: CatalogQueryDto) {
    return this.software.listWhitelist(q);
  }

  @Get('whitelist/:id')
  @RequirePermissions('software:read')
  getWhitelist(@Param('id', ParseUUIDPipe) id: string) {
    return this.software.getWhitelist(id);
  }

  @Post('whitelist')
  @RequirePermissions('software:write')
  createWhitelist(@Body() dto: CreateWhitelistDto, @CurrentUser() user: AuthUser) {
    return this.software.createWhitelist(dto, user);
  }

  @Patch('whitelist/:id')
  @RequirePermissions('software:write')
  updateWhitelist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWhitelistDto) {
    return this.software.updateWhitelist(id, dto);
  }

  @Delete('whitelist/:id')
  @RequirePermissions('software:write')
  @HttpCode(204)
  async deleteWhitelist(@Param('id', ParseUUIDPipe) id: string) {
    await this.software.deleteWhitelist(id);
  }

  @Get('blacklist')
  @RequirePermissions('software:read')
  listBlacklist(@Query() q: CatalogQueryDto) {
    return this.software.listBlacklist(q);
  }

  @Get('blacklist/:id')
  @RequirePermissions('software:read')
  getBlacklist(@Param('id', ParseUUIDPipe) id: string) {
    return this.software.getBlacklist(id);
  }

  @Post('blacklist')
  @RequirePermissions('software:write')
  createBlacklist(@Body() dto: CreateBlacklistDto, @CurrentUser() user: AuthUser) {
    return this.software.createBlacklist(dto, user);
  }

  @Patch('blacklist/:id')
  @RequirePermissions('software:write')
  updateBlacklist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlacklistDto) {
    return this.software.updateBlacklist(id, dto);
  }

  @Delete('blacklist/:id')
  @RequirePermissions('software:write')
  @HttpCode(204)
  async deleteBlacklist(@Param('id', ParseUUIDPipe) id: string) {
    await this.software.deleteBlacklist(id);
  }

  @Post('uninstall')
  @RequirePermissions('software:write')
  @HttpCode(200)
  uninstall(@Body() dto: UninstallDto, @CurrentUser() user: AuthUser) {
    return this.software.uninstall(dto.deviceIds, dto.name, dto.version, user);
  }

  @Get('licenses')
  @RequirePermissions('software:read')
  licenses() {
    return this.software.licenses();
  }

  @Post('reclassify')
  @RequirePermissions('software:write')
  @HttpCode(200)
  reclassify(@CurrentUser() user: AuthUser) {
    return this.software.reclassify(user);
  }
}
