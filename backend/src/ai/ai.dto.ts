import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiInsightStatus, AiInsightType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { DATE_RE } from '../workforce/core/time';

const DATE_MSG = { message: '$property must be a date in YYYY-MM-DD format' };

export class AiInsightQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, DATE_MSG) date?: string;
  @ApiPropertyOptional({ enum: AiInsightType }) @IsOptional() @IsEnum(AiInsightType) type?: AiInsightType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ enum: AiInsightStatus }) @IsOptional() @IsEnum(AiInsightStatus) status?: AiInsightStatus;
}

export class EmployeeInsightRequestDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ example: '2026-09-25' }) @Matches(DATE_RE, DATE_MSG) date: string;
}

export class ManagementInsightRequestDto {
  @ApiProperty({ example: '2026-09-25' }) @Matches(DATE_RE, DATE_MSG) date: string;
  @ApiPropertyOptional({ description: 'Omit for the org-wide summary' }) @IsOptional() @IsUUID() departmentId?: string;
}
