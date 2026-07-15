import {
  IsString,
  IsInt,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  IsUUID,
  IsIn,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// Canonical product lifecycle statuses (single source of truth).
import { PRODUCT_STATUSES, ProductStatus } from './product-integration.dto';

export class CreateProductDto {
  @ApiProperty({ example: '3760123456789' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  ean: string;

  @ApiProperty({ example: 'Coca-Cola 33cl' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'boissons' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'unit', default: 'unit' })
  @IsOptional()
  @IsString()
  unitType?: string;

  @ApiProperty({ example: 150, description: 'Price in minor units (cents)' })
  @IsInt()
  @Min(0)
  priceMinorUnits: number;

  @ApiPropertyOptional({ example: 'EUR', default: 'EUR' })
  @IsOptional()
  @IsString()
  currencyCode?: string;

  @ApiPropertyOptional({ example: 80, description: 'Cost in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  costMinorUnits?: number;

  @ApiPropertyOptional({ example: 20.0, default: 20.0, description: 'Tax rate percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 100, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockAlertThreshold?: number;

  @ApiPropertyOptional({ example: 5, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockCriticalThreshold?: number;

  @ApiPropertyOptional({ description: 'Brand id (uuid) for the product' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Supplier id (uuid) for the product' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Internal SKU / reference (unique per store when set)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({ example: 200, description: 'Struck-through / former price in minor units (for promo display)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  oldPriceMinorUnits?: number;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES, description: 'Lifecycle status (aligns with isActive)' })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitType?: string;

  @ApiPropertyOptional({ description: 'Price in minor units (cents)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinorUnits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currencyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  costMinorUnits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiPropertyOptional({ description: 'Product image as data URL or URL. Send null to remove.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  stockAlertThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  stockCriticalThreshold?: number;

  @ApiPropertyOptional({ description: 'Reason for change (used for price history)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Brand id (uuid). Send null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ description: 'Supplier id (uuid). Send null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  supplierId?: string | null;

  @ApiPropertyOptional({ description: 'Internal SKU / reference (unique per store when set)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({ description: 'Struck-through / former price in minor units. Send null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  oldPriceMinorUnits?: number | null;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES, description: 'Lifecycle status (aligns with isActive)' })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

/** Hierarchical product category — create with an optional parent. */
export class CreateCategoryDto {
  @ApiProperty({ example: 'Boissons' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: 'Parent category id (uuid) for a sub-category' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentId?: string | null;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Boissons sans alcool' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'New parent category id (uuid). Send null to move to root.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentId?: string | null;
}
