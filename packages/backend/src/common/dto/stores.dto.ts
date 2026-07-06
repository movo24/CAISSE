import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsEmail,
  IsUUID,
  IsBoolean,
  IsIn,
  IsDateString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STORE_TYPES = ['permanent', 'kiosk', 'corner', 'popup', 'warehouse', 'office'] as const;
export const OPERATING_MODES = ['succursale', 'franchise', 'affilie', 'licence', 'partenaire', 'autre'] as const;
export const STORE_STATUSES = ['projet', 'preparation', 'ouvert', 'ferme_temporaire', 'ferme_definitif'] as const;
/** Operating modes that require an operating company (exploitant) to be named. */
export const MODES_REQUIRING_COMPANY = ['franchise', 'affilie', 'licence', 'partenaire'] as const;

export class CreateStoreDto {
  @ApiProperty({ example: 'Boutique Opéra' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'MAG-001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  storeCode?: string;

  @ApiPropertyOptional({ example: '1 Place de l\'Opéra' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'Paris' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: '75009' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  @ApiPropertyOptional({ example: '+33 1 23 45 67 89' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'store@example.com' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'EUR', default: 'EUR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @ApiPropertyOptional({ example: 'Europe/Paris', default: 'Europe/Paris' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsUUID()
  unitId?: string;

  // ── Commercial identity ──
  @ApiPropertyOptional({ enum: STORE_TYPES })
  @IsOptional() @IsIn(STORE_TYPES as unknown as string[])
  storeType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  addressExtra?: string;

  @ApiPropertyOptional({ default: 'France' }) @IsOptional() @IsString() @MaxLength(100)
  country?: string;

  // ── Operating mode / status ──
  @ApiPropertyOptional({ enum: OPERATING_MODES })
  @IsOptional() @IsIn(OPERATING_MODES as unknown as string[])
  operatingMode?: string;

  @ApiPropertyOptional({ enum: STORE_STATUSES })
  @IsOptional() @IsIn(STORE_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional() @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString()
  expectedOpeningDate?: string;

  @ApiPropertyOptional() @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString()
  actualOpeningDate?: string;

  // ── Operating company (exploitant) + legal identity ──
  @ApiPropertyOptional({ example: 'Rail Food SAS' }) @IsOptional() @IsString() @MaxLength(200)
  operatingCompanyName?: string;

  @ApiPropertyOptional({ example: "The Wesley's" }) @IsOptional() @IsString() @MaxLength(200)
  operatingCompanyTradeName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() siren?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() siret?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tvaIntracom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() formeJuridique?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rcs?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() naf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() capitalSocial?: string;

  // ── Operational parameters ──
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPos?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowReporting?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPilotStore?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) managerName?: string;
  @ApiPropertyOptional() @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '') @IsEmail() managerEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) managerPhone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() networkId?: string;
}

export class UpdateStoreDto {
  // ── Operating mode / status / commercial identity (see CreateStoreDto) ──
  @ApiPropertyOptional({ enum: STORE_TYPES }) @IsOptional() @IsIn(STORE_TYPES as unknown as string[]) storeType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) addressExtra?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional({ enum: OPERATING_MODES }) @IsOptional() @IsIn(OPERATING_MODES as unknown as string[]) operatingMode?: string;
  @ApiPropertyOptional({ enum: STORE_STATUSES }) @IsOptional() @IsIn(STORE_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() expectedOpeningDate?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() actualOpeningDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) operatingCompanyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) operatingCompanyTradeName?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPos?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowReporting?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPilotStore?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) managerName?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsEmail() managerEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) managerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  storeCode?: string;

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
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
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
