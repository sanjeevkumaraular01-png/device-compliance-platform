import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContextService } from '../auth/auth-context.service';
import { RequirePermissions } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

export class UpdateRoleDto {
  @ApiProperty({ type: [String], enum: PERMISSIONS })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(PERMISSIONS as unknown as string[], { each: true })
  permissions: string[];
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authCtx: AuthContextService,
  ) {}

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return roles.map(({ _count, ...r }) => ({ ...r, userCount: _count.users }));
  }

  async update(id: string, permissions: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.key === 'SUPER_ADMIN') {
      throw new UnprocessableEntityException('Super Admin permissions cannot be modified');
    }
    const updated = await this.prisma.role.update({ where: { id }, data: { permissions } });
    await this.authCtx.invalidateRole(id);
    await this.audit.log({
      category: 'SECURITY',
      action: 'role.permissions.update',
      resourceType: 'Role',
      resourceId: id,
      before: { permissions: role.permissions },
      after: { permissions },
      metadata: { role: role.key },
    });
    return updated;
  }
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('users:read')
  list() {
    return this.roles.list();
  }

  @Get('permissions')
  @RequirePermissions('users:read')
  permissions() {
    return [...PERMISSIONS];
  }

  @Patch(':id')
  @RequirePermissions('roles:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto.permissions);
  }
}

@Module({
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
