import {
  IsString,
  IsInt,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  IsIn,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INTEGRATION_SOURCES = ['pos', 'dashboard', 'inventory', 'mobile'] as const;
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];

export const PRODUCT_STATUSES = [
  'draft',
  'pending_validation',
  'active',
  'rejected',
  'archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Fiche produit proposée lors d'une demande d'intégration (tout optionnel). */
export class ProductProposalDto {
  @ApiPropertyOptional({ example: 'Coca-Cola 33cl' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brandName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  categoryName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierName?: string;

  @ApiPropertyOptional({ description: "Prix d'achat en centimes" })
  @IsOptional()
  @IsInt()
  @Min(0)
  costMinorUnits?: number;

  @ApiPropertyOptional({ description: 'Prix de vente en centimes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinorUnits?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiPropertyOptional({ example: 'unit' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unitType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Stock initial' })
  @IsOptional()
  @IsInt()
  @Min(0)
  initialStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;
}

/** Demande d'intégration produit (seule action possible depuis la caisse). */
export class CreateIntegrationRequestDto {
  @ApiProperty({ example: '3760123456789' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  barcode: string;

  @ApiProperty({ enum: INTEGRATION_SOURCES })
  @IsIn(INTEGRATION_SOURCES as unknown as string[])
  source: IntegrationSource;

  @ApiPropertyOptional({ description: 'Terminal caisse (si source = pos)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  terminalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({ type: ProductProposalDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductProposalDto)
  proposal?: ProductProposalDto;
}

/** Vérification d'un code opérateur (admin / employé autorisé). */
export class AuthorizeOperatorDto {
  @ApiProperty({ description: 'Code PIN admin ou employé autorisé' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  pin: string;
}

/**
 * Création sécurisée d'une fiche produit (Dashboard / Inventaire uniquement).
 * Autorisation : session manager/admin, OU `pin` d'un opérateur autorisé.
 */
export class CreateSecuredProductDto {
  @ApiPropertyOptional({ description: 'Code opérateur si la session ne suffit pas' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pin?: string;

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

  @ApiProperty({ description: 'Prix de vente en centimes' })
  @IsInt()
  @Min(0)
  priceMinorUnits: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  costMinorUnits?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiPropertyOptional({ example: 'unit' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unitType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brandName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional({ description: 'Stock initial' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({
    description:
      "true → tenter d'activer (réservé admin/responsable) ; sinon pending_validation",
  })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;

  @ApiPropertyOptional({ description: 'Demande d’intégration à convertir' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

/** Approbation d'une demande — champs manquants complétés à la volée. */
export class ApproveIntegrationRequestDto {
  @ApiPropertyOptional({ type: ProductProposalDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductProposalDto)
  overrides?: ProductProposalDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

export class RejectIntegrationRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
