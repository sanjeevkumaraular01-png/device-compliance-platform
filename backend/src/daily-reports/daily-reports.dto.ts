import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DailyReportStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { DATE_RE } from '../workforce/core/time';

const DATE_MSG = { message: '$property must be a date in YYYY-MM-DD format' };

export class DailyReportItemDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() taskId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) projectName?: string | null;
  @ApiProperty() @IsString() @MaxLength(300) taskTitle: string;
  @ApiProperty({ description: 'Concrete work done (>= 15 chars, not only generic words)' }) @IsString() @MaxLength(5000) workCompleted: string;
  @ApiProperty() @IsString() @MaxLength(2000) result: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) pendingWork?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) blocker?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) nextAction?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'] }) @MaxLength(2000) evidenceUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(1440) minutesSpent?: number | null;
}

export class SaveDailyReportDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(5000) summary?: string | null;
  @ApiProperty({ type: [DailyReportItemDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DailyReportItemDto) items: DailyReportItemDto[];
}

export class SubmitDailyReportDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(5000) summary?: string | null;
  @ApiPropertyOptional({ type: [DailyReportItemDto], description: 'When given, saved before submitting' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DailyReportItemDto) items?: DailyReportItemDto[];
}

export const REPORT_LIST_STATUSES = [...Object.values(DailyReportStatus), 'MISSING'] as const;

export class DailyReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, DATE_MSG) date?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, DATE_MSG) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, DATE_MSG) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: REPORT_LIST_STATUSES }) @IsOptional() @IsIn(REPORT_LIST_STATUSES) status?: (typeof REPORT_LIST_STATUSES)[number];
}

export class ReviewDailyReportDto {
  @ApiProperty({ enum: ['APPROVED', 'CHANGES_REQUESTED'] }) @IsIn(['APPROVED', 'CHANGES_REQUESTED']) status: 'APPROVED' | 'CHANGES_REQUESTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
