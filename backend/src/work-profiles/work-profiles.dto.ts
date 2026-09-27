import { WorkProfileKey } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWorkProfileDto {
  @IsEnum(WorkProfileKey)
  key!: WorkProfileKey;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Device policy applied automatically to devices of employees on this profile. */
  @IsOptional()
  @IsUUID()
  policyId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  requiredSoftware?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  prohibitedSoftware?: string[];
}

export class UpdateWorkProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUUID()
  policyId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  requiredSoftware?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  prohibitedSoftware?: string[];
}

export class AssignWorkProfileDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(1000)
  userIds!: string[];
}
