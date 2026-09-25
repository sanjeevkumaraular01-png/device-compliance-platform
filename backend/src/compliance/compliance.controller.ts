import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { ComplianceResultQueryDto, EvaluateDto, UpdateRuleDto } from './compliance.dto';
import { ComplianceService } from './compliance.service';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('rules')
  @RequirePermissions('compliance:read')
  rules() {
    return this.compliance.listRules();
  }

  @Patch('rules/:id')
  @RequirePermissions('compliance:write')
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRuleDto) {
    return this.compliance.updateRule(id, dto);
  }

  @Get('results')
  @RequirePermissions('compliance:read')
  results(@Query() q: ComplianceResultQueryDto, @CurrentUser() user: AuthUser) {
    return this.compliance.results(q, user);
  }

  @Get('devices/:deviceId/history')
  @RequirePermissions('compliance:read')
  history(@Param('deviceId', ParseUUIDPipe) deviceId: string, @CurrentUser() user: AuthUser) {
    return this.compliance.history(deviceId, user);
  }

  @Post('evaluate')
  @RequirePermissions('compliance:write')
  @HttpCode(202)
  async evaluate(@Body() dto: EvaluateDto) {
    return { queued: await this.compliance.queueDevices(dto.deviceIds) };
  }

  @Get('summary')
  @RequirePermissions('compliance:read')
  summary(@CurrentUser() user: AuthUser) {
    return this.compliance.summary(user);
  }
}
