import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AlertCategory, AlertChannelType, AlertSeverity, AlertStatus } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class AlertQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AlertStatus }) @IsOptional() @IsEnum(AlertStatus) status?: AlertStatus;
  @ApiPropertyOptional({ enum: AlertSeverity }) @IsOptional() @IsEnum(AlertSeverity) severity?: AlertSeverity;
  @ApiPropertyOptional({ enum: AlertCategory }) @IsOptional() @IsEnum(AlertCategory) category?: AlertCategory;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
}

export class BulkAlertDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID('all', { each: true }) ids: string[];
  @ApiProperty({ enum: ['acknowledge', 'resolve'] }) @IsIn(['acknowledge', 'resolve']) action: 'acknowledge' | 'resolve';
}

export class CreateChannelDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ enum: AlertChannelType }) @IsEnum(AlertChannelType) type: AlertChannelType;
  @ApiProperty({ type: Object, description: 'Write-only; returned masked' }) @IsObject() config: Record<string, unknown>;
  @ApiPropertyOptional({ enum: AlertSeverity }) @IsOptional() @IsEnum(AlertSeverity) minSeverity?: AlertSeverity;
  @ApiPropertyOptional({ enum: AlertCategory, isArray: true }) @IsOptional() @IsArray() @IsEnum(AlertCategory, { each: true }) categories?: AlertCategory[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateChannelDto extends PartialType(CreateChannelDto) {}
