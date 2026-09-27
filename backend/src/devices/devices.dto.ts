import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  CommandType,
  ComplianceState,
  DeviceStatus,
  DeviceType,
  OsPlatform,
  PatchSeverity,
  PatchState,
  RiskLevel,
  SoftwareStatus,
  UsbEventType,
  WarrantyStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto, ToBoolean } from '../common/dto/pagination.dto';

export class DeviceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform;
  @ApiPropertyOptional({ enum: ComplianceState }) @IsOptional() @IsEnum(ComplianceState) complianceState?: ComplianceState;
  @ApiPropertyOptional({ enum: RiskLevel }) @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @ApiPropertyOptional({ enum: DeviceStatus }) @IsOptional() @IsEnum(DeviceStatus) status?: DeviceStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() policyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional({ enum: DeviceType }) @IsOptional() @IsEnum(DeviceType) deviceType?: DeviceType;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() online?: boolean;
  @ApiPropertyOptional({ enum: WarrantyStatus }) @IsOptional() @IsEnum(WarrantyStatus) warrantyStatus?: WarrantyStatus;
}

export class CreateDeviceDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) deviceName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) serialNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) assetId?: string;
  @ApiProperty({ enum: OsPlatform }) @IsEnum(OsPlatform) platform: OsPlatform;
  @ApiPropertyOptional({ enum: DeviceType }) @IsOptional() @IsEnum(DeviceType) deviceType?: DeviceType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) hostname?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) manufacturer?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) model?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cpu?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) ramMb?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) storageGb?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) osName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) osVersion?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) osBuild?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() policyId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() purchaseDate?: Date | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() warrantyExpiresAt?: Date | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCompanyOwned?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiPropertyOptional({ enum: [DeviceStatus.ACTIVE, DeviceStatus.INACTIVE] })
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}

export class AssignDeviceDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UnassignDeviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RetireQueryDto {
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() hard?: boolean;
}

export class CreateCommandDto {
  @ApiProperty({ enum: CommandType }) @IsEnum(CommandType) type: CommandType;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

export class DeviceSoftwareQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SoftwareStatus }) @IsOptional() @IsEnum(SoftwareStatus) status?: SoftwareStatus;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() includeRemoved?: boolean;
}

export class DevicePatchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PatchState }) @IsOptional() @IsEnum(PatchState) state?: PatchState;
  @ApiPropertyOptional({ enum: PatchSeverity }) @IsOptional() @IsEnum(PatchSeverity) severity?: PatchSeverity;
}

export class DeviceUsbEventQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UsbEventType }) @IsOptional() @IsEnum(UsbEventType) eventType?: UsbEventType;
}

export class QuarantineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class TimelineQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) @Min(1) @Max(3650) days?: number;
}
