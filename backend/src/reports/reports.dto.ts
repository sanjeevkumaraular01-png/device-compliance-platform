import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceState, OsPlatform, ReportFormat, ReportStatus, ReportType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class ReportParametersDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform;
  @ApiPropertyOptional({ enum: ComplianceState }) @IsOptional() @IsEnum(ComplianceState) complianceState?: ComplianceState;
}

export class CreateReportDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiProperty({ enum: ReportType }) @IsEnum(ReportType) type: ReportType;
  @ApiProperty({ enum: ReportFormat }) @IsEnum(ReportFormat) format: ReportFormat;
  @ApiPropertyOptional({ type: ReportParametersDto }) @IsOptional() @ValidateNested() @Type(() => ReportParametersDto) parameters?: ReportParametersDto;
}

export class ReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportType }) @IsOptional() @IsEnum(ReportType) type?: ReportType;
  @ApiPropertyOptional({ enum: ReportStatus }) @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
  @ApiPropertyOptional({ enum: ReportFormat }) @IsOptional() @IsEnum(ReportFormat) format?: ReportFormat;
}

export class CreateScheduleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty({ enum: ReportType }) @IsEnum(ReportType) type: ReportType;
  @ApiProperty({ enum: ReportFormat }) @IsEnum(ReportFormat) format: ReportFormat;
  @ApiProperty({ example: '0 7 * * 1', description: 'cron expression (UTC)' }) @IsString() @MaxLength(120) cron: string;
  @ApiPropertyOptional({ type: ReportParametersDto }) @IsOptional() @ValidateNested() @Type(() => ReportParametersDto) parameters?: ReportParametersDto;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsEmail({ require_tld: false }, { each: true }) recipients: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}
