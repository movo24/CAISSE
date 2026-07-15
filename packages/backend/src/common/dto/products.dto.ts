import {
  IsString,
  IsInt,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  IsUUID,
  IsIn,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  Min,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// Canonical product lifecycle statuses (single source of truth).
import { PRODUCT_STATUSES, ProductStatus } from './product-integration.dto';

/** Types de produit déclaratifs (Lot 2). */
export const PRODUCT_TYPES = ['simple', 'variant', 'pack', 'service', 'deposit', 'gift_card'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

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

  // ── Lot 2 — champs additifs (colonnes migration 1760) ──
  @ApiPropertyOptional({ description: 'Nom court pour la caisse' })
  @IsOptional() @IsString() @MaxLength(120)
  shortName?: string;

  @ApiPropertyOptional({ description: 'Référence interne (distincte du SKU)' })
  @IsOptional() @IsString() @MaxLength(100)
  internalRef?: string;

  @ApiPropertyOptional({ description: 'Référence fournisseur' })
  @IsOptional() @IsString() @MaxLength(100)
  supplierRef?: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional() @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiPropertyOptional({ description: "Pays d'origine" })
  @IsOptional() @IsString() @MaxLength(80)
  countryOfOrigin?: string;

  @ApiPropertyOptional({ description: 'Délai fournisseur (jours)' })
  @IsOptional() @IsInt() @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Quantité minimale de commande (MOQ)' })
  @IsOptional() @IsInt() @Min(0)
  minOrderQuantity?: number;

  @ApiPropertyOptional({ description: 'Poids (grammes)' })
  @IsOptional() @IsInt() @Min(0)
  weightGrams?: number;

  @ApiPropertyOptional({ description: 'Largeur (mm)' })
  @IsOptional() @IsInt() @Min(0)
  widthMm?: number;

  @ApiPropertyOptional({ description: 'Hauteur (mm)' })
  @IsOptional() @IsInt() @Min(0)
  heightMm?: number;

  @ApiPropertyOptional({ description: 'Profondeur (mm)' })
  @IsOptional() @IsInt() @Min(0)
  depthMm?: number;

  @ApiPropertyOptional({ description: 'Volume (ml)' })
  @IsOptional() @IsInt() @Min(0)
  volumeMl?: number;

  @ApiPropertyOptional({ description: 'Unités par carton' })
  @IsOptional() @IsInt() @Min(0)
  unitsPerCarton?: number;

  @ApiPropertyOptional({ description: 'Produit saisonnier' })
  @IsOptional() @IsBoolean()
  isSeasonal?: boolean;

  @ApiPropertyOptional({ description: 'Mois de début de saison (1-12)' })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  seasonStartMonth?: number;

  @ApiPropertyOptional({ description: 'Mois de fin de saison (1-12)' })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  seasonEndMonth?: number;
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

  // ── Lot 2 — champs additifs (colonnes migration 1760) ──
  @ApiPropertyOptional({ description: 'Nom court pour la caisse' })
  @IsOptional() @IsString() @MaxLength(120)
  shortName?: string;

  @ApiPropertyOptional({ description: 'Référence interne (distincte du SKU)' })
  @IsOptional() @IsString() @MaxLength(100)
  internalRef?: string;

  @ApiPropertyOptional({ description: 'Référence fournisseur' })
  @IsOptional() @IsString() @MaxLength(100)
  supplierRef?: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional() @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiPropertyOptional({ description: "Pays d'origine" })
  @IsOptional() @IsString() @MaxLength(80)
  countryOfOrigin?: string;

  @ApiPropertyOptional({ description: 'Délai fournisseur (jours)' })
  @IsOptional() @IsInt() @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Quantité minimale de commande (MOQ)' })
  @IsOptional() @IsInt() @Min(0)
  minOrderQuantity?: number;

  @ApiPropertyOptional({ description: 'Poids (grammes)' })
  @IsOptional() @IsInt() @Min(0)
  weightGrams?: number;

  @ApiPropertyOptional({ description: 'Largeur (mm)' })
  @IsOptional() @IsInt() @Min(0)
  widthMm?: number;

  @ApiPropertyOptional({ description: 'Hauteur (mm)' })
  @IsOptional() @IsInt() @Min(0)
  heightMm?: number;

  @ApiPropertyOptional({ description: 'Profondeur (mm)' })
  @IsOptional() @IsInt() @Min(0)
  depthMm?: number;

  @ApiPropertyOptional({ description: 'Volume (ml)' })
  @IsOptional() @IsInt() @Min(0)
  volumeMl?: number;

  @ApiPropertyOptional({ description: 'Unités par carton' })
  @IsOptional() @IsInt() @Min(0)
  unitsPerCarton?: number;

  @ApiPropertyOptional({ description: 'Produit saisonnier' })
  @IsOptional() @IsBoolean()
  isSeasonal?: boolean;

  @ApiPropertyOptional({ description: 'Mois de début de saison (1-12)' })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  seasonStartMonth?: number;

  @ApiPropertyOptional({ description: 'Mois de fin de saison (1-12)' })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  seasonEndMonth?: number;
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

export const BULK_PRODUCT_ACTIONS = ['activate', 'deactivate', 'setCategory', 'setSupplier', 'setTax'] as const;
export type BulkProductAction = (typeof BULK_PRODUCT_ACTIONS)[number];

/** Action de masse sur une sélection de produits (endpoint dédié, tracée). */
export class BulkProductActionDto {
  @ApiProperty({ enum: BULK_PRODUCT_ACTIONS })
  @IsIn(BULK_PRODUCT_ACTIONS)
  action: BulkProductAction;

  @ApiProperty({ description: 'Ids (uuid) des produits ciblés', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  productIds: string[];

  @ApiPropertyOptional({ description: 'Catégorie cible (id) — action setCategory' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Fournisseur cible (uuid) — action setSupplier' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Taux de TVA — action setTax' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
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
