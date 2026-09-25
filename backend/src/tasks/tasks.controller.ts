import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, RequirePermissions, SkipIpRestriction } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { TasksService } from './tasks.service';
import {
  CreateProjectDto,
  CreateTaskDto,
  ImportTasksDto,
  ManualTimeDto,
  ProjectQueryDto,
  TaskQueryDto,
  UpdateProjectDto,
  UpdateTaskDto,
  WebhookTasksDto,
} from './tasks.dto';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('workforce:self')
  list(@Query() q: ProjectQueryDto, @CurrentUser() user: AuthUser) {
    return this.tasks.listProjects(user, q);
  }

  @Get(':id')
  @RequirePermissions('workforce:self')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.getProject(user, id);
  }

  @Post()
  @RequirePermissions('tasks:manage')
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    return this.tasks.createProject(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('tasks:manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto, @CurrentUser() user: AuthUser) {
    return this.tasks.updateProject(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('tasks:manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.tasks.deleteProject(user, id);
  }
}

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Paginated tasks with trackedSec, estimatedMinutes and variancePercent' })
  list(@Query() q: TaskQueryDto, @CurrentUser() user: AuthUser) {
    return this.tasks.list(user, q);
  }

  @Post('stop')
  @HttpCode(200)
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Stop the running timer → TimeEntry (409 when none is running)' })
  stop(@CurrentUser() user: AuthUser) {
    return this.tasks.stop(user);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('tasks:manage')
  @ApiOperation({ summary: 'Upsert tasks by (source, externalRef) from CRM / support / dev tools' })
  import(@Body() dto: ImportTasksDto, @CurrentUser() user: AuthUser) {
    return this.tasks.import(user, dto.source, dto.items, 'api');
  }

  @Post('webhook/:source')
  @HttpCode(200)
  @Public()
  @SkipIpRestriction()
  @ApiHeader({ name: 'X-SEM-Task-Token', required: true, description: 'Must equal the taskWebhookToken setting' })
  @ApiOperation({ summary: 'Task import for external systems (token-authenticated)' })
  webhook(@Param('source') source: string, @Headers('x-sem-task-token') token: string | undefined, @Body() dto: WebhookTasksDto) {
    return this.tasks.webhook(source, token, dto.items);
  }

  @Get(':id')
  @RequirePermissions('workforce:self')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.get(user, id);
  }

  @Post()
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Create a task (employees: only for themselves)' })
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('workforce:self')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('workforce:self')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.tasks.remove(user, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('workforce:self')
  @ApiOperation({ summary: 'Start a timer (stops any running one) → TimeEntry' })
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.start(user, id);
  }

  @Post(':id/time')
  @RequirePermissions('workforce:self')
  manual(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualTimeDto, @CurrentUser() user: AuthUser) {
    return this.tasks.manualTime(user, id, dto);
  }
}
