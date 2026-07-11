import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Demande d'enrôlement envoyée par la caisse. `machineId` est l'empreinte
 * matérielle stable ; le magasin provient du JWT (tenant), jamais du corps.
 */
export class RequestEnrollmentDto {
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  machineId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  terminalLabel: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  machineName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}

export class RejectEnrollmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class RevokeEnrollmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
