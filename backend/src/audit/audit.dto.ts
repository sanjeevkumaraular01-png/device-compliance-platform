import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto, ToBoolean } from '../common/dto/pagination.dto';

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditCategory }) @IsOptional() @IsEnum(AuditCategory) category?: AuditCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) resourceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() success?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class AuditExportQueryDto extends AuditQueryDto {
  @ApiPropertyOptional({ enum: ['csv'], default: 'csv' }) @IsOptional() @IsIn(['csv']) format?: 'csv';
}

export class LoginHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() success?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}
