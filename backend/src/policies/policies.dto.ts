import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

export class CreatePolicyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyDataOnlyManaged?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() usbStorageBlocked?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowWhitelistedUsb?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() usbReadOnly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blockUnauthorizedSoftware?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoUninstallBlacklisted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireAntivirus?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireEdr?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireFirewall?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireDiskEncryption?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireSecureBoot?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365) maxAvSignatureAgeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoUpdateEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoPatchDeployment?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) patchDeadlineDays?: number;
  @ApiPropertyOptional({ description: 'cron expression' }) @IsOptional() @IsString() @MaxLength(120) maintenanceWindow?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() screenLockEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(86400) screenLockTimeoutSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requirePasswordOnWake?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() screenSaverEnforced?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(86400) checkinIntervalSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(300) @Max(604800) inventoryIntervalSec?: number;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() extraSettings?: Record<string, unknown>;
}

export class UpdatePolicyDto extends PartialType(CreatePolicyDto) {}

export class AssignPolicyDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) deviceIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) departmentIds?: string[];
}
