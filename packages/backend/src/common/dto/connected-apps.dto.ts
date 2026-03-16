import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsUUID,
  IsIn,
  IsUrl,
  IsArray,
  IsBoolean,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConnectedAppDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  organizationId: string;

  @ApiProperty({ example: 'Uber Eats Integration' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: 'internal',
    default: 'internal',
    enum: ['internal', 'external', 'rented'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['internal', 'external', 'rented'])
  type?: string;

  @ApiPropertyOptional({
    example: 'active',
    default: 'active',
    enum: ['active', 'inactive', 'error', 'syncing'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive', 'error', 'syncing'])
  status?: string;

  @ApiPropertyOptional({ example: 'https://app.example.com' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsUrl()
  appUrl?: string;

  @ApiPropertyOptional({ example: 'https://api.example.com/v1' })
  @IsOptional()
  @IsString()
  apiUrl?: string;

  @ApiPropertyOptional({ example: 'https://hooks.example.com/webhook' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Array of unit UUIDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  unitIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Array of store UUIDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  storeIds?: string[];
}

export class UpdateConnectedAppDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ['internal', 'external', 'rented'] })
  @IsOptional()
  @IsString()
  @IsIn(['internal', 'external', 'rented'])
  type?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'error', 'syncing'] })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive', 'error', 'syncing'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsUrl()
  appUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  unitIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  storeIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
