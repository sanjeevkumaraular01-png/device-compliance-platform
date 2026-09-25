import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { MatchType, OsPlatform, RiskLevel, SoftwareStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class InventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SoftwareStatus }) @IsOptional() @IsEnum(SoftwareStatus) status?: SoftwareStatus;
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform;
}

export class UnauthorizedQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [SoftwareStatus.UNAUTHORIZED, SoftwareStatus.BLACKLISTED] })
  @IsOptional()
  @IsEnum(SoftwareStatus)
  status?: SoftwareStatus;
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
}

export class CatalogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform;
}

export class CreateWhitelistDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) publisher?: string | null;
  @ApiPropertyOptional({ enum: MatchType }) @IsOptional() @IsEnum(MatchType) matchType?: MatchType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) minVersion?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) category?: string | null;
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform | null;
  @ApiPropertyOptional({ example: 'PER_SEAT' }) @IsOptional() @IsString() @MaxLength(32) licenseType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) licenseCount?: number | null;
  @ApiPropertyOptional({ description: 'Write-only; stored encrypted' }) @IsOptional() @IsString() @MaxLength(2000) licenseKey?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() licenseExpiresAt?: Date | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) costPerSeat?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(500) vendorUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}
export class UpdateWhitelistDto extends PartialType(CreateWhitelistDto) {}

export class CreateBlacklistDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) publisher?: string | null;
  @ApiPropertyOptional({ enum: MatchType }) @IsOptional() @IsEnum(MatchType) matchType?: MatchType;
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform | null;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) reason: string;
  @ApiPropertyOptional({ enum: RiskLevel }) @IsOptional() @IsEnum(RiskLevel) severity?: RiskLevel;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoUninstall?: boolean;
}
export class UpdateBlacklistDto extends PartialType(CreateBlacklistDto) {}

export class UninstallDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @IsUUID('all', { each: true }) deviceIds: string[];
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) version?: string;
}
