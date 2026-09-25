import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as fs from 'fs';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/types';
import { CreateReportDto, CreateScheduleDto, ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Schedules first so "schedules" is not captured by ":id".
  @Get('schedules')
  @RequirePermissions('reports:read')
  listSchedules(@Query() q: PaginationQueryDto) {
    return this.reports.listSchedules(q);
  }

  @Post('schedules')
  @RequirePermissions('reports:create')
  createSchedule(@Body() dto: CreateScheduleDto, @CurrentUser() user: AuthUser) {
    return this.reports.createSchedule(dto, user);
  }

  @Get('schedules/:id')
  @RequirePermissions('reports:read')
  getSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getSchedule(id);
  }

  @Delete('schedules/:id')
  @RequirePermissions('reports:create')
  @HttpCode(204)
  async deleteSchedule(@Param('id', ParseUUIDPipe) id: string) {
    await this.reports.deleteSchedule(id);
  }

  @Get()
  @RequirePermissions('reports:read')
  list(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.list(q, user);
  }

  @Post()
  @RequirePermissions('reports:create')
  create(@Body() dto: CreateReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions('reports:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.reports.get(id, user);
  }

  @Get(':id/download')
  @RequirePermissions('reports:read')
  async download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const f = await this.reports.download(id, user);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    if (f.size) res.setHeader('Content-Length', String(f.size));
    fs.createReadStream(f.file).pipe(res);
  }

  @Delete(':id')
  @RequirePermissions('reports:create')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.reports.remove(id, user);
  }
}
