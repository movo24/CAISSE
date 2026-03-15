import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStoreDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currencyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxId?: string;

  // French legal fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  siret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  siren?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  naf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tvaIntracom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rcs?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  capitalSocial?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formeJuridique?: string;

  // Ticket customization
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  headerMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerMessage?: string;

  // Geolocation
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  longitude?: number;

  // Network
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  networkId?: string;
}
