import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { CreateUserDto, ImportUsersDto, UpdateUserDto, UserQueryDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@Query() q: UserQueryDto, @CurrentUser() user: AuthUser) {
    return this.users.list(q, user);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.users.get(id, user);
  }

  @Post()
  @RequirePermissions('users:write')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.create(dto, user);
  }

  @Post('import')
  @RequirePermissions('users:write')
  @HttpCode(200)
  import(@Body() dto: ImportUsersDto, @CurrentUser() user: AuthUser) {
    return this.users.importUsers(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('users:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('users:write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.users.deactivate(id, user);
  }

  @Post(':id/reset-mfa')
  @RequirePermissions('users:write')
  @HttpCode(200)
  resetMfa(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.users.resetMfa(id, user);
  }

  @Post(':id/unlock')
  @RequirePermissions('users:write')
  @HttpCode(200)
  unlock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.users.unlock(id, user);
  }
}
