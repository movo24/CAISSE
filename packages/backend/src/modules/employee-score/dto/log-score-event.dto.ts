import { IsString, IsNotEmpty, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SCORE_EVENT_TYPES } from '../employee-score.constants';

/**
 * Journalisation d'un fait POS probant. La caisse envoie l'événement ; le
 * backend résout la règle et le poids. employeeId/storeId sont forcés depuis la
 * session JWT côté contrôleur — jamais depuis le corps.
 */
export class LogScoreEventDto {
  @ApiProperty({ enum: SCORE_EVENT_TYPES })
  @IsIn(SCORE_EVENT_TYPES as unknown as string[])
  eventType: string;

  @ApiPropertyOptional({ description: 'Terminal caisse (signature technique)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  terminalId?: string;

  @ApiPropertyOptional({ description: 'Session POS active' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Employé cible si différent du connecté (ex: manager loggant pour un caissier)' })
  @IsOptional()
  @IsString()
  targetEmployeeId?: string;
}

export class RecomputeScoreDto {
  @ApiProperty({ example: '2026-07-07' })
  @IsString()
  @IsNotEmpty()
  scoreDate: string;
}
