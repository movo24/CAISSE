import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GuardCartItemDto {
  @IsString()
  productId: string;

  /** Required so the global ValidationPipe (forbidNonWhitelisted) accepts it. */
  @IsOptional()
  @IsString()
  ean?: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  /** Charged unit price. When omitted, the server uses the catalogue price. */
  @IsOptional()
  @IsInt()
  sellPriceMinorUnits?: number;

  /** Catalogue unit price. When omitted, the server fills it from the product. */
  @IsOptional()
  @IsInt()
  catalogPriceMinorUnits?: number;

  /** null allowed → cost not set on product */
  @IsOptional()
  @IsInt()
  costMinorUnits?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountMinorUnits?: number;

  @IsOptional()
  @IsBoolean()
  manualPriceOverride?: boolean;

  @IsOptional()
  @IsBoolean()
  isFreeProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  recentPriceChange?: boolean;
}

export class EvaluateSaleGuardsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardCartItemDto)
  items: GuardCartItemDto[];

  @IsOptional()
  @IsUUID()
  saleId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeProductUsageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCount?: number;
}
