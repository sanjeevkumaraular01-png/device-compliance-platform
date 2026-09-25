import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { UsbAccessStatus, UsbDeviceClass, UsbEventType, WhitelistScope } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto, ToBoolean } from '../common/dto/pagination.dto';

const HEX_ID = /^[0-9A-Fa-f]{4}$/;

export class UsbDeviceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() isWhitelisted?: boolean;
  @ApiPropertyOptional({ enum: UsbDeviceClass }) @IsOptional() @IsEnum(UsbDeviceClass) deviceClass?: UsbDeviceClass;
}

export class CreateUsbWhitelistDto {
  @ApiProperty({ example: '0781' }) @IsString() @Matches(HEX_ID, { message: 'vendorId must be 4 hex digits' }) vendorId: string;
  @ApiProperty({ example: '5581' }) @IsString() @Matches(HEX_ID, { message: 'productId must be 4 hex digits' }) productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) productName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) manufacturer?: string;
  @ApiProperty({ enum: UsbDeviceClass }) @IsEnum(UsbDeviceClass) deviceClass: UsbDeviceClass;
  @ApiProperty({ enum: WhitelistScope }) @IsEnum(WhitelistScope) whitelistScope: WhitelistScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() scopeRefId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readOnly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateUsbDeviceDto extends PartialType(CreateUsbWhitelistDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isWhitelisted?: boolean;
}

export class UsbEventQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
  @ApiPropertyOptional({ enum: UsbEventType }) @IsOptional() @IsEnum(UsbEventType) eventType?: UsbEventType;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8) vendorId?: string;
}

export class UsbRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UsbAccessStatus }) @IsOptional() @IsEnum(UsbAccessStatus) status?: UsbAccessStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
}

export class CreateUsbRequestDto {
  @ApiProperty() @IsUUID() deviceId: string;
  @ApiProperty() @IsString() @Matches(HEX_ID, { message: 'vendorId must be 4 hex digits' }) vendorId: string;
  @ApiProperty() @IsString() @Matches(HEX_ID, { message: 'productId must be 4 hex digits' }) productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) serialNumber?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) reason: string;
  @ApiProperty({ minimum: 1, maximum: 72 }) @IsInt() @Min(1) @Max(72) durationHours: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readOnly?: boolean;
}

export class ApproveUsbRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 72 }) @IsOptional() @IsInt() @Min(1) @Max(72) durationHours?: number;
}

export class DenyUsbRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class UsbStatsQueryDto {
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}
