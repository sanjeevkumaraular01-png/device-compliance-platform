import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OsPlatform } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class CreateEnrollmentTokenDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional({ enum: OsPlatform }) @IsOptional() @IsEnum(OsPlatform) platform?: OsPlatform;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() policyId?: string;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @IsInt() @Min(1) @Max(100000) maxUses?: number;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @IsInt() @Min(1) @Max(365) expiresInDays?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() autoApprove?: boolean;
}

export class InstallCommandQueryDto {
  @ApiProperty() @IsUUID() tokenId: string;
  @ApiProperty({ enum: OsPlatform }) @IsEnum(OsPlatform) platform: OsPlatform;
  @ApiPropertyOptional({ description: 'Raw token (only known right after creation) to embed in the command' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  token?: string;
}

export class EnrollmentListQueryDto extends PaginationQueryDto {}

export class RejectDeviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
