import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RoleKey } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
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
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
