import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsUUID,
  IsIn,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUnitDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  organizationId: string;

  @ApiProperty({ example: 'Magasin Centre-Ville' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: 'retail',
    default: 'retail',
    enum: ['retail', 'warehouse', 'headquarters', 'franchise', 'popup'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['retail', 'warehouse', 'headquarters', 'franchise', 'popup'])
  type?: string;

  @ApiPropertyOptional({ example: 'FR', default: 'FR' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  country?: string;

  @ApiPropertyOptional({ example: 'EUR', default: 'EUR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateUnitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    enum: ['retail', 'warehouse', 'headquarters', 'franchise', 'popup'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['retail', 'warehouse', 'headquarters', 'franchise', 'popup'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
