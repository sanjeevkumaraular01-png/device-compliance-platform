import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ProjectStatus, TaskPriority, TaskSource, TaskStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto, ToBoolean } from '../common/dto/pagination.dto';
import { LenientValidation } from '../common/validation.pipe';

export class CreateProjectDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty({ example: 'CRM-Q4' }) @IsString() @Matches(/^[A-Za-z0-9._-]{2,40}$/, { message: 'code must be 2-40 letters, digits, dot, dash or underscore' }) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) clientName?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() ownerId?: string | null;
  @ApiPropertyOptional({ enum: ProjectStatus }) @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) budgetHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueDate?: string | null;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class ProjectQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus }) @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}

export class CreateTaskDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional({ enum: TaskSource }) @IsOptional() @IsEnum(TaskSource) source?: TaskSource;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) externalRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
  @ApiPropertyOptional({ enum: TaskPriority }) @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) estimatedMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueDate?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() projectId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() assigneeId?: string | null;
  @ApiPropertyOptional({ enum: TaskStatus }) @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @ApiPropertyOptional({ enum: TaskPriority }) @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(100_000) estimatedMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() dueDate?: string | null;
}

export class TaskQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ enum: TaskStatus }) @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @ApiPropertyOptional({ enum: TaskSource }) @IsOptional() @IsEnum(TaskSource) source?: TaskSource;
  @ApiPropertyOptional({ description: 'Only tasks assigned to the caller' }) @IsOptional() @ToBoolean() mine?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueBefore?: string;
}

export class ManualTimeDto {
  @ApiProperty() @IsISO8601() startedAt: string;
  @ApiProperty() @IsISO8601() endedAt: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ImportTaskItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) externalRef: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail({ require_tld: false }) assigneeEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) projectCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) estimatedMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueDate?: string;
  @ApiPropertyOptional({ enum: TaskPriority }) @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
}

export class ImportTasksDto {
  @ApiProperty({ enum: TaskSource }) @IsEnum(TaskSource) source: TaskSource;
  @ApiProperty({ type: [ImportTaskItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ImportTaskItemDto)
  items: ImportTaskItemDto[];
}

/** External systems may send extra fields; the source comes from the URL. */
@LenientValidation()
export class WebhookTasksDto {
  @ApiPropertyOptional({ enum: TaskSource }) @IsOptional() @IsEnum(TaskSource) source?: TaskSource;
  @ApiProperty({ type: [ImportTaskItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ImportTaskItemDto)
  items: ImportTaskItemDto[];
}
