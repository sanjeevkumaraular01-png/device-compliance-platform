import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DeploySessionDto {
  @ApiProperty({ example: 'EMP-1001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  employeeCode: string;
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
