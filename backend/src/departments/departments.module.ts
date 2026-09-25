import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto, orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { scopedDepartmentIds, isScoped } from '../common/scope';
import type { AuthUser } from '../common/types';

export class CreateDepartmentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ example: 'ENG' }) @IsString() @Matches(/^[A-Z0-9_-]{2,16}$/) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() policyId?: string | null;
}
export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

const INCLUDE = {
  manager: { select: { id: true, displayName: true, email: true } },
  policy: { select: { id: true, name: true } },
  _count: { select: { users: true, devices: true } },
} satisfies Prisma.DepartmentInclude;

type DeptRow = Prisma.DepartmentGetPayload<{ include: typeof INCLUDE }>;

function serialize(d: DeptRow) {
  const { _count, ...rest } = d;
  return { ...rest, userCount: _count.users, deviceCount: _count.devices };
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: PaginationQueryDto, user: AuthUser) {
    const where: Prisma.DepartmentWhereInput = {};
    if (isScoped(user)) where.id = { in: scopedDepartmentIds(user) };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { code: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        include: INCLUDE,
        orderBy: orderBy({ sortBy: q.sortBy, sortOrder: q.sortBy ? q.sortOrder : 'asc' }, ['name', 'code', 'createdAt'], 'name'),
        ...skipTake(q),
      }),
      this.prisma.department.count({ where }),
    ]);
    return paginated(rows.map(serialize), q.page, q.pageSize, total);
  }

  async get(id: string) {
    const d = await this.prisma.department.findUnique({ where: { id }, include: INCLUDE });
    if (!d) throw new NotFoundException('Department not found');
    return serialize(d);
  }

  async create(dto: CreateDepartmentDto) {
    const dup = await this.prisma.department.findFirst({ where: { OR: [{ name: dto.name }, { code: dto.code }] } });
    if (dup) throw new ConflictException('Department name or code already exists');
    const d = await this.prisma.department.create({ data: dto, include: INCLUDE });
    await this.audit.log({ category: 'USER_ACTION', action: 'department.create', resourceType: 'Department', resourceId: d.id, after: dto });
    return serialize(d);
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const before = await this.get(id);
    const d = await this.prisma.department.update({ where: { id }, data: dto, include: INCLUDE });
    await this.audit.log({
      category: dto.policyId !== undefined ? 'POLICY_CHANGE' : 'USER_ACTION',
      action: 'department.update',
      resourceType: 'Department',
      resourceId: id,
      before: { name: before.name, code: before.code, managerId: before.managerId, policyId: before.policyId },
      after: dto,
    });
    return serialize(d);
  }

  async remove(id: string) {
    const before = await this.get(id);
    await this.prisma.department.delete({ where: { id } });
    await this.audit.log({ category: 'USER_ACTION', action: 'department.delete', resourceType: 'Department', resourceId: id, before });
  }
}

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@Query() q: PaginationQueryDto, @CurrentUser() user: AuthUser) {
    return this.departments.list(q, user);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.get(id);
  }

  @Post()
  @RequirePermissions('users:write')
  create(@Body() dto: CreateDepartmentDto) {
    return this.departments.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('users:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departments.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('users:write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.departments.remove(id);
  }
}

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
})
export class DepartmentsModule {}
