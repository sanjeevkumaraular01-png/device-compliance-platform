import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { DailyReportsService } from './daily-reports.service';
import { DailyReportQueryDto, ReviewDailyReportDto, SaveDailyReportDto, SubmitDailyReportDto } from './daily-reports.dto';

@ApiTags('daily-reports')
@ApiBearerAuth()
@Controller('daily-reports')
export class DailyReportsController {
  constructor(private readonly reports: DailyReportsService) {}

  @Get('me/:date')
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Own report for a date; unsaved draft pre-filled from autoDraft when none exists' })
  getMine(@Param('date') date: string, @CurrentUser() user: AuthUser) {
    return this.reports.getMine(user, date);
  }

  @Put('me/:date')
  @RequirePermissions('workforce:self')
  saveMine(@Param('date') date: string, @Body() dto: SaveDailyReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.saveMine(user, date, dto);
  }

  @Post('me/:date/submit')
  @HttpCode(200)
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Validate + submit (422 with per-item messages when vague/incomplete)' })
  submitMine(@Param('date') date: string, @Body() dto: SubmitDailyReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.submitMine(user, date, dto);
  }

  @Get()
  @RequirePermissions('workforce:read')
  @ApiOperation({ summary: 'Team reports with MISSING pseudo-rows (paginated)' })
  list(@Query() q: DailyReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.list(user, q);
  }

  @Get(':id')
  @RequirePermissions('workforce:self')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.reports.get(user, id);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermissions('tasks:manage')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDailyReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.review(user, id, dto);
  }
}
