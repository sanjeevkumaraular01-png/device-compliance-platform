import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class DirectoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
  /** signed = acknowledged the current notice; pending = has not. */
  @ApiPropertyOptional({ enum: ['signed', 'pending'] }) @IsOptional() @IsIn(['signed', 'pending']) acknowledgement?: 'signed' | 'pending';
}

export class OnboardDto {
  @ApiPropertyOptional({ description: 'Email the install link to the employee (requires SMTP)' })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

export class OffboardDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class PublishNoticeDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) title: string;
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(20000) body: string;
}

export class AcknowledgeDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) noticeVersion: number;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) signedName: string;
}
