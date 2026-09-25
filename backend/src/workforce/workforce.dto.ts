import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ActivityCategory, AppRuleKind, AttendanceStatus, MatchType, WorkLocation } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { LenientValidation } from '../common/validation.pipe';
import { DATE_RE, HM_RE, MONTH_RE } from './core/time';

const DATE_MSG = { message: '$property must be a date in YYYY-MM-DD format' };
const HM_MSG = { message: '$property must be a time in HH:mm format' };

// ───────────────────────── Policies & app rules ─────────────────────────

export class CreateWorkforcePolicyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackingEnabled?: boolean;
  @ApiPropertyOptional({ example: 'Asia/Kolkata' }) @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiPropertyOptional({ type: [Number], description: 'ISO weekdays 1=Mon..7=Sun' })
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) workDays?: number[];
  @ApiPropertyOptional({ example: '09:30' }) @IsOptional() @Matches(HM_RE, HM_MSG) workStart?: string;
  @ApiPropertyOptional({ example: '18:30' }) @IsOptional() @Matches(HM_RE, HM_MSG) workEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(240) graceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) minDailyMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) halfDayMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) overtimeAfterMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(600) maxBreakMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackOutsideWorkHours?: boolean;
  @ApiPropertyOptional({ minimum: 120, maximum: 1800 }) @IsOptional() @IsInt() @Min(120) @Max(1800) idleThresholdSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackApps?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackWebsites?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() captureWindowTitles?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() screenshotsEnabled?: boolean;
  @ApiPropertyOptional({ minimum: 5, maximum: 120 }) @IsOptional() @IsInt() @Min(5) @Max(120) screenshotIntervalMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() screenshotBlur?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 365 }) @IsOptional() @IsInt() @Min(1) @Max(365) screenshotRetentionDays?: number;
  @ApiPropertyOptional({ type: [String], description: 'Office CIDRs or "ssid:<name>"' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(120, { each: true }) officeNetworks?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireTaskSelection?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireDailyReport?: boolean;
  @ApiPropertyOptional({ example: '19:30' }) @IsOptional() @Matches(HM_RE, HM_MSG) dailyReportDueTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertLateLogin?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) alertNoActivityMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) alertIdlePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) alertOvertimeMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) alertUnproductivePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() employeeCanSeeOwnData?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showTrackingNotice?: boolean;
}

export class UpdateWorkforcePolicyDto extends PartialType(CreateWorkforcePolicyDto) {}

export class AssignWorkforcePolicyDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) departmentIds: string[];
}

export class CreateAppRuleDto {
  @ApiProperty({ enum: AppRuleKind }) @IsEnum(AppRuleKind) kind: AppRuleKind;
  @ApiProperty({ description: 'Process/app name, domain or regex' }) @IsString() @MinLength(1) @MaxLength(255) pattern: string;
  @ApiPropertyOptional({ enum: MatchType }) @IsOptional() @IsEnum(MatchType) matchType?: MatchType;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) label: string;
  @ApiProperty({ enum: ActivityCategory }) @IsEnum(ActivityCategory) category: ActivityCategory;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() departmentId?: string | null;
}

export class UpdateAppRuleDto extends PartialType(CreateAppRuleDto) {}

export class AppRuleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AppRuleKind }) @IsOptional() @IsEnum(AppRuleKind) kind?: AppRuleKind;
  @ApiPropertyOptional({ enum: ActivityCategory }) @IsOptional() @IsEnum(ActivityCategory) category?: ActivityCategory;
  @ApiPropertyOptional({ description: 'UUID, or "global" for rules without a department' }) @IsOptional() @IsString() @MaxLength(64) departmentId?: string;
}

// ───────────────────────── Common queries ─────────────────────────

export class DateQueryDto {
  @ApiPropertyOptional({ example: '2026-09-25' }) @IsOptional() @Matches(DATE_RE, DATE_MSG) date?: string;
}

export class RangeQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @Matches(DATE_RE, DATE_MSG) from?: string;
  @ApiPropertyOptional({ example: '2026-09-25' }) @IsOptional() @Matches(DATE_RE, DATE_MSG) to?: string;
}

export const LIVE_STATUSES = ['ONLINE_ACTIVE', 'ONLINE_IDLE', 'ON_BREAK', 'OFFLINE', 'CLOCKED_OUT'] as const;

export class LiveQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ enum: LIVE_STATUSES }) @IsOptional() @IsIn(LIVE_STATUSES) status?: (typeof LIVE_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class SummaryQueryDto extends DateQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}

// ───────────────────────── Clock / attendance ─────────────────────────

export class ClockDto {
  @ApiProperty({ enum: ['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END'] })
  @IsIn(['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END'])
  type: 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, DATE_MSG) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, DATE_MSG) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: AttendanceStatus }) @IsOptional() @IsEnum(AttendanceStatus) status?: AttendanceStatus;
}

export class MonthlyQueryDto {
  @ApiProperty({ example: '2026-09' }) @Matches(MONTH_RE, { message: 'month must be YYYY-MM' }) month: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}

export class AttendanceExportQueryDto extends MonthlyQueryDto {
  @ApiProperty({ enum: ['csv', 'xlsx'] }) @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx';
}

export class AttendanceCorrectionDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() clockInAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() clockOutAt?: string | null;
  @ApiPropertyOptional({ enum: AttendanceStatus }) @IsOptional() @IsEnum(AttendanceStatus) status?: AttendanceStatus;
  @ApiPropertyOptional({ enum: WorkLocation }) @IsOptional() @IsEnum(WorkLocation) location?: WorkLocation;
  @ApiProperty({ description: 'Reason for the correction (audited)' }) @IsString() @MinLength(3) @MaxLength(1000) note: string;
}

export class LeaveDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ example: '2026-09-29' }) @Matches(DATE_RE, DATE_MSG) from: string;
  @ApiProperty({ example: '2026-09-30' }) @Matches(DATE_RE, DATE_MSG) to: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) reason: string;
}

export class HrmsSettingsDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiPropertyOptional({ example: 'https://hrms.example.com/api/attendance' })
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) @MaxLength(1000) webhookUrl?: string;
  @ApiPropertyOptional({ description: 'Write-only. Sent as the Authorization header value' }) @IsOptional() @IsString() @MaxLength(2000) authHeader?: string;
  @ApiPropertyOptional({ example: '06:00' }) @IsOptional() @Matches(HM_RE, HM_MSG) sendDailyAt?: string;
}

// ───────────────────────── Analytics ─────────────────────────

export const GROUP_BY = ['employee', 'department', 'project', 'task', 'day'] as const;

export class AnalyticsQueryDto extends RangeQueryDto {
  @ApiProperty({ enum: GROUP_BY }) @IsIn(GROUP_BY) groupBy: (typeof GROUP_BY)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
}

export class AnalyticsAppsQueryDto extends RangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: ActivityCategory }) @IsOptional() @IsEnum(ActivityCategory) category?: ActivityCategory;
}

// ───────────────────────── Screenshots ─────────────────────────

export class ScreenshotQueryDto extends DateQueryDto {
  @ApiProperty() @IsUUID() userId: string;
}

// ───────────────────────── Agent protocol ─────────────────────────

export class ActivitySegmentDto {
  @ApiProperty() @IsISO8601() startedAt: string;
  @ApiProperty() @IsISO8601() endedAt: string;
  @ApiProperty() @IsBoolean() active: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) app?: string;
  @ApiPropertyOptional({ description: 'Dropped unless policy.captureWindowTitles' }) @IsOptional() @IsString() @MaxLength(1024) windowTitle?: string;
  @ApiPropertyOptional({ description: 'Host only; path/query are stripped' }) @IsOptional() @IsString() @MaxLength(1024) domain?: string;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) inputEvents: number;
}

export class ActivityNetworkDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(32) @IsString({ each: true }) @MaxLength(64, { each: true }) ips: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) ssid?: string;
}

export class SessionEventDto {
  @ApiProperty({ enum: ['LOCK', 'UNLOCK', 'LOGON', 'LOGOFF', 'SLEEP', 'WAKE'] })
  @IsIn(['LOCK', 'UNLOCK', 'LOGON', 'LOGOFF', 'SLEEP', 'WAKE'])
  type: 'LOCK' | 'UNLOCK' | 'LOGON' | 'LOGOFF' | 'SLEEP' | 'WAKE';
  @ApiProperty() @IsISO8601() at: string;
}

@LenientValidation()
export class AgentActivityDto {
  @ApiProperty({ example: 'CORP\\ekta' }) @IsString() @MaxLength(255) osUser: string;
  @ApiPropertyOptional({ type: ActivityNetworkDto }) @IsOptional() @ValidateNested() @Type(() => ActivityNetworkDto) network?: ActivityNetworkDto;
  @ApiProperty({ type: [ActivitySegmentDto] }) @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ActivitySegmentDto) segments: ActivitySegmentDto[];
  @ApiPropertyOptional({ type: [SessionEventDto] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => SessionEventDto) sessionEvents?: SessionEventDto[];
}

@LenientValidation()
export class AgentScreenshotDto {
  @ApiProperty() @IsISO8601() capturedAt: string;
  @ApiProperty() @IsString() @MaxLength(255) osUser: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) activeApp?: string;
  @ApiProperty({ enum: ['true', 'false'] }) @IsIn(['true', 'false']) blurred: 'true' | 'false';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() width?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() height?: number;
}
