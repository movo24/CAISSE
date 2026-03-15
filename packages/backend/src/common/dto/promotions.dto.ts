import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsIn,
  IsDateString,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePromoDto {
  @ApiProperty({ example: '2+1 gratuit boissons' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    example: 'buy_x_get_discount',
    enum: ['percentage', 'fixed_amount', 'buy_x_get_discount', 'first_purchase'],
  })
  @IsString()
  @IsIn(['percentage', 'fixed_amount', 'buy_x_get_discount', 'first_purchase'])
  type: string;

  @ApiPropertyOptional({ example: 2, description: 'Buy quantity (for buy_x_get_discount)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  buyQuantity?: number;

  @ApiPropertyOptional({ example: 10, description: 'Discount percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ example: 500, description: 'Fixed discount in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountFixedMinorUnits?: number;

  @ApiPropertyOptional({ type: [String], description: 'Applicable product IDs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableProductIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Applicable category IDs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableCategoryIds?: string[];

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: '2025-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  discountFixedMinorUnits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  buyQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableProductIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableCategoryIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
