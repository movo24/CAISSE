import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsEmail,
  IsBoolean,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Ma Société SAS' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Ma Société SAS' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ example: '12345678901234', description: '14-digit SIRET number' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/, { message: 'siret must be exactly 14 digits' })
  siret?: string;

  @ApiPropertyOptional({ example: '123456789', description: '9-digit SIREN number' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'siren must be exactly 9 digits' })
  siren?: string;

  @ApiPropertyOptional({ example: 'FR12345678901' })
  @IsOptional()
  @IsString()
  tvaIntracom?: string;

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
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'contact@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+33 1 23 45 67 89' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '12 Rue de la Paix' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Paris' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: '75001' })
  @IsOptional()
  @IsString()
  postalCode?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ description: '14-digit SIRET number' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/, { message: 'siret must be exactly 14 digits' })
  siret?: string;

  @ApiPropertyOptional({ description: '9-digit SIREN number' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'siren must be exactly 9 digits' })
  siren?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tvaIntracom?: string;

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
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
