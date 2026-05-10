import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * DTO classes for mobile-auth endpoints.
 *
 * Without these, the global ValidationPipe accepts empty bodies, which then
 * crash the service with `TypeError: Cannot read properties of undefined`.
 * With these, missing/invalid fields produce clean 400 responses.
 */

export class MobileRegisterDto {
  @IsEmail({}, { message: 'Email invalide' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Mot de passe : 8 caractères minimum' })
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsUUID()
  preferredStoreId?: string;
}

export class MobileLoginDto {
  @IsEmail({}, { message: 'Email invalide' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class MobileRefreshDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2048)
  refreshToken: string;
}

export class MobileUpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsUUID()
  preferredStoreId?: string;
}
