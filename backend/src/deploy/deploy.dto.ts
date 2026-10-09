import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class NoticeAcknowledgementDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) noticeVersion: number;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) signedName: string;
  @ApiProperty() @IsBoolean() accepted: boolean;
}

export class DeploySessionDto {
  @ApiProperty({ example: 'EMP-1001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  employeeCode: string;

  /** Required when a monitoring notice is published. */
  @ApiPropertyOptional({ type: NoticeAcknowledgementDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NoticeAcknowledgementDto)
  acknowledgement?: NoticeAcknowledgementDto;
}

export class DeploySettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) companyName?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) imapHost?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(65535) imapPort?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() imapSecure?: boolean;
}
