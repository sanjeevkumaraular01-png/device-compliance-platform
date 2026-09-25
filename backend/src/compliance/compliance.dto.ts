import { ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceState, RiskLevel } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class UpdateRuleDto {
  @ApiPropertyOptional({ enum: RiskLevel }) @IsOptional() @IsEnum(RiskLevel) severity?: RiskLevel;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() markNonCompliant?: boolean;
}

export class ComplianceResultQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ComplianceState }) @IsOptional() @IsEnum(ComplianceState) state?: ComplianceState;
  @ApiPropertyOptional({ enum: RiskLevel }) @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}

export class EvaluateDto {
  @ApiPropertyOptional({ type: [String], description: 'Empty = all devices' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsUUID('all', { each: true })
  deviceIds?: string[];
}
