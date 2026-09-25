import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { clientIp } from '../common/request-context';
import type { AuthUser } from '../common/types';
import { WorkforceLiveService } from './live.service';
import { WorkSessionsService } from './sessions.service';
import { AttendanceService } from './attendance.service';
import { WorkforcePoliciesService } from './policies.service';
import { WorkforceAnalyticsService } from './analytics.service';
import { ScreenshotsService } from './screenshots.service';
import {
  AnalyticsAppsQueryDto,
  AnalyticsQueryDto,
  AppRuleQueryDto,
  AssignWorkforcePolicyDto,
  AttendanceCorrectionDto,
  AttendanceExportQueryDto,
  AttendanceQueryDto,
  ClockDto,
  CreateAppRuleDto,
  CreateWorkforcePolicyDto,
  DateQueryDto,
  HrmsSettingsDto,
  LeaveDto,
  LiveQueryDto,
  MonthlyQueryDto,
  RangeQueryDto,
  ScreenshotQueryDto,
  SummaryQueryDto,
  UpdateAppRuleDto,
  UpdateWorkforcePolicyDto,
} from './workforce.dto';

/** Live dashboard, My Day, employee day/timeline/apps, clock (docs/WORKFORCE.md). */
@ApiTags('workforce')
@ApiBearerAuth()
@Controller('workforce')
export class WorkforceController {
  constructor(
    private readonly live: WorkforceLiveService,
    private readonly sessions: WorkSessionsService,
  ) {}

  @Get('live')
  @RequirePermissions('workforce:read')
  @ApiOperation({ summary: 'Live board: LiveEmployee[] (managers: own departments)' })
  liveBoard(@Query() q: LiveQueryDto, @CurrentUser() user: AuthUser) {
    return this.live.live(user, q);
  }

  @Get('summary')
  @RequirePermissions('workforce:read')
  summary(@Query() q: SummaryQueryDto, @CurrentUser() user: AuthUser) {
    return this.live.summary(user, q);
  }

  @Get('me')
  @RequirePermissions('workforce:self')
  me(@CurrentUser() user: AuthUser) {
    return this.live.me(user);
  }

  @Get('users/:userId/day')
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'EmployeeDay (self, or workforce:read within scope)' })
  day(@Param('userId', ParseUUIDPipe) userId: string, @Query() q: DateQueryDto, @CurrentUser() user: AuthUser) {
    return this.live.day(user, userId, q.date);
  }

  @Get('users/:userId/timeline')
  @RequirePermissions('workforce:self')
  timeline(@Param('userId', ParseUUIDPipe) userId: string, @Query() q: DateQueryDto, @CurrentUser() user: AuthUser) {
    return this.live.timeline(user, userId, q.date);
  }

  @Get('users/:userId/apps')
  @RequirePermissions('workforce:self')
  apps(@Param('userId', ParseUUIDPipe) userId: string, @Query() q: RangeQueryDto, @CurrentUser() user: AuthUser) {
    return this.live.apps(user, userId, q.from, q.to);
  }

  @Post('clock')
  @HttpCode(200)
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Clock in/out or start/end a break (self) → WorkSession' })
  clock(@Body() dto: ClockDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.sessions.clock(user, dto, clientIp(req) ?? null);
  }
}

@ApiTags('workforce-attendance')
@ApiBearerAuth()
@Controller('workforce')
export class WorkforceAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('attendance')
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Paginated WorkSession & { user } (employees: own rows only)' })
  list(@Query() q: AttendanceQueryDto, @CurrentUser() user: AuthUser) {
    return this.attendance.list(user, q);
  }

  @Get('attendance/monthly')
  @RequirePermissions('workforce:self')
  monthly(@Query() q: MonthlyQueryDto, @CurrentUser() user: AuthUser) {
    return this.attendance.monthly(user, q);
  }

  @Get('attendance/export')
  @RequirePermissions('workforce:self')
  @ApiProduces('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async export(@Query() q: AttendanceExportQueryDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const f = await this.attendance.export(user, q);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(f.body);
  }

  @Patch('attendance/:sessionId')
  @RequirePermissions('workforce:manage')
  correct(@Param('sessionId', ParseUUIDPipe) id: string, @Body() dto: AttendanceCorrectionDto, @CurrentUser() user: AuthUser) {
    return this.attendance.correct(user, id, dto);
  }

  @Post('leave')
  @RequirePermissions('workforce:manage')
  leave(@Body() dto: LeaveDto, @CurrentUser() user: AuthUser) {
    return this.attendance.leave(user, dto);
  }

  @Get('hrms')
  @RequirePermissions('workforce:manage')
  getHrms(@CurrentUser() user: AuthUser) {
    return this.attendance.getHrms(user);
  }

  @Put('hrms')
  @RequirePermissions('workforce:manage')
  putHrms(@Body() dto: HrmsSettingsDto, @CurrentUser() user: AuthUser) {
    return this.attendance.putHrms(user, dto);
  }

  @Post('hrms/test')
  @HttpCode(200)
  @RequirePermissions('workforce:manage')
  testHrms(@CurrentUser() user: AuthUser) {
    return this.attendance.testHrms(user);
  }
}

@ApiTags('workforce-settings')
@ApiBearerAuth()
@Controller('workforce')
@RequirePermissions('workforce:manage')
export class WorkforceSettingsController {
  constructor(private readonly policies: WorkforcePoliciesService) {}

  @Get('policies')
  listPolicies() {
    return this.policies.listPolicies();
  }

  @Get('policies/:id')
  getPolicy(@Param('id', ParseUUIDPipe) id: string) {
    return this.policies.getPolicy(id);
  }

  @Post('policies')
  createPolicy(@Body() dto: CreateWorkforcePolicyDto) {
    return this.policies.createPolicy(dto);
  }

  @Patch('policies/:id')
  updatePolicy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkforcePolicyDto) {
    return this.policies.updatePolicy(id, dto);
  }

  @Delete('policies/:id')
  @HttpCode(204)
  async deletePolicy(@Param('id', ParseUUIDPipe) id: string) {
    await this.policies.deletePolicy(id);
  }

  @Post('policies/:id/assign')
  @HttpCode(200)
  assignPolicy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignWorkforcePolicyDto) {
    return this.policies.assignPolicy(id, dto);
  }

  @Get('app-rules')
  listRules(@Query() q: AppRuleQueryDto) {
    return this.policies.listRules(q);
  }

  @Post('app-rules')
  createRule(@Body() dto: CreateAppRuleDto) {
    return this.policies.createRule(dto);
  }

  @Patch('app-rules/:id')
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAppRuleDto) {
    return this.policies.updateRule(id, dto);
  }

  @Delete('app-rules/:id')
  @HttpCode(204)
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    await this.policies.deleteRule(id);
  }

  @Get('uncategorized')
  uncategorized(@Query() q: RangeQueryDto) {
    return this.policies.uncategorized(q);
  }
}

@ApiTags('workforce-analytics')
@ApiBearerAuth()
@Controller('workforce/analytics')
@RequirePermissions('workforce:read')
export class WorkforceAnalyticsController {
  constructor(private readonly analytics: WorkforceAnalyticsService) {}

  @Get()
  analyticsReport(@Query() q: AnalyticsQueryDto, @CurrentUser() user: AuthUser) {
    return this.analytics.analytics(user, q);
  }

  @Get('apps')
  apps(@Query() q: AnalyticsAppsQueryDto, @CurrentUser() user: AuthUser) {
    return this.analytics.apps(user, q);
  }
}

@ApiTags('workforce-screenshots')
@ApiBearerAuth()
@Controller('workforce/screenshots')
@RequirePermissions('workforce:self')
export class WorkforceScreenshotsController {
  constructor(private readonly screenshots: ScreenshotsService) {}

  @Get()
  @ApiOperation({ summary: 'Screenshot metadata for a user/day (workforce:screenshots, or self)' })
  list(@Query() q: ScreenshotQueryDto, @CurrentUser() user: AuthUser) {
    return this.screenshots.list(user, q);
  }

  @Get(':id/image')
  @ApiProduces('image/jpeg')
  async image(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const data = await this.screenshots.image(user, id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(data.length));
    res.send(data);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.screenshots.remove(user, id);
  }
}
