import { ArrayMaxSize, IsArray, IsHexColor, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDeviceGroupDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsHexColor()
  color?: string | null;
}

export class UpdateDeviceGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsHexColor()
  color?: string | null;
}

export class GroupMembersDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(5000)
  deviceIds!: string[];
}
