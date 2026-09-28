import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RoleKey } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto, ToBoolean } from '../common/dto/pagination.dto';

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RoleKey }) @IsOptional() @IsEnum(RoleKey) roleKey?: RoleKey;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() isActive?: boolean;
}

export class CreateUserDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({ require_tld: false })
  @MaxLength(254)
  email: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) displayName: string;
  @ApiProperty({ enum: RoleKey }) @IsEnum(RoleKey) roleKey: RoleKey;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) password?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) employeeCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workProfileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string | null;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ImportUserRow {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({ require_tld: false })
  @MaxLength(254)
  email: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) displayName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) employeeCode?: string;
  /** Department name or code; resolved to an existing department. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string;
  @ApiPropertyOptional({ enum: RoleKey }) @IsOptional() @IsEnum(RoleKey) roleKey?: RoleKey;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(254)
  managerEmail?: string;
}

export class ImportUsersDto {
  @ApiProperty({ type: [ImportUserRow] })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportUserRow)
  rows: ImportUserRow[];
}
