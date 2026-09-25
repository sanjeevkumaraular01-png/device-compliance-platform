import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'admin@secureendpoint.local' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({ require_tld: false })
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

export class LdapLoginDto {
  @ApiProperty({ example: 'jdoe' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  username: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

export class MfaVerifyDto {
  @ApiProperty() @IsString() @MaxLength(4096) mfaToken: string;
  @ApiProperty({ description: '6-digit TOTP or recovery code' }) @IsString() @Length(6, 32) code: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MaxLength(512) refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(256) currentPassword: string;
  @ApiProperty() @IsString() @MaxLength(256) newPassword: string;
}

export class MfaCodeDto {
  @ApiProperty() @IsString() @Length(6, 32) code: string;
}
