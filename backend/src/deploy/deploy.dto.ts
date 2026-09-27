import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DeploySessionDto {
  @ApiProperty({ example: 'jane@company.com' })
  @IsEmail()
  @MaxLength(200)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password: string;
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
