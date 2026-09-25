import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermissions } from '../common/decorators';
import { SettingsService } from './settings.service';

export class CreateIpRestrictionDto {
  @IsString() @MaxLength(64) cidr: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@RequirePermissions('settings:write')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('ip-restrictions')
  listIp() {
    return this.settings.listIpRestrictions();
  }

  @Post('ip-restrictions')
  addIp(@Body() dto: CreateIpRestrictionDto) {
    return this.settings.addIpRestriction(dto.cidr, dto.description);
  }

  @Delete('ip-restrictions/:id')
  @HttpCode(204)
  async removeIp(@Param('id', ParseUUIDPipe) id: string) {
    await this.settings.removeIpRestriction(id);
  }

  @Get()
  getAll() {
    return this.settings.getAll();
  }

  @Patch()
  @ApiBody({ schema: { type: 'object', additionalProperties: true, example: { sessionTimeoutMinutes: 30 } } })
  patch(@Body() body: Record<string, unknown>) {
    return this.settings.patch(body);
  }
}
