import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { AiService } from './ai.service';
import { AiInsightQueryDto, EmployeeInsightRequestDto, ManagementInsightRequestDto } from './ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: '{ enabled, model, lastRun } — enabled=false without ANTHROPIC_API_KEY' })
  status() {
    return this.ai.status();
  }

  @Get('insights')
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'AI insights (employees: own EMPLOYEE_DAILY only; managers: own departments)' })
  list(@Query() q: AiInsightQueryDto, @CurrentUser() user: AuthUser) {
    return this.ai.list(user, q);
  }

  @Get('insights/:id')
  @RequirePermissions('workforce:self')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.ai.get(user, id);
  }

  @Post('insights/employee')
  @HttpCode(200)
  @RequirePermissions('workforce:ai')
  @ApiOperation({ summary: 'Generate an employee insight now (sync). 422 when AI is not configured' })
  employee(@Body() dto: EmployeeInsightRequestDto, @CurrentUser() user: AuthUser) {
    return this.ai.requestEmployee(user, dto.userId, dto.date);
  }

  @Post('insights/management')
  @HttpCode(200)
  @RequirePermissions('workforce:ai')
  @ApiOperation({ summary: 'Generate a department / org-wide management summary now (sync)' })
  management(@Body() dto: ManagementInsightRequestDto, @CurrentUser() user: AuthUser) {
    return this.ai.requestManagement(user, dto.date, dto.departmentId ?? null);
  }
}
