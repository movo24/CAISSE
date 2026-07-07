import { IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for opening a POS session.
 *
 * NOT in the body:
 *   - employeeId — comes from the authenticated JWT (req.user.employeeId).
 *     The client cannot set it.
 *   - terminalId — comes from the X-Terminal-Id header (γ-model: sessions
 *     are terminal-bound, the header is required). Body cannot set it
 *     either: one source of truth, no ambiguity between body and header.
 */
export class OpenSessionDto {
  /**
   * Explicit flag for offline mode at session open. Defaults to false.
   */
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  offlineMode?: boolean;

  /**
   * Fond de caisse déclaré à l'ouverture (centimes). Optionnel : s'il est
   * absent, le montant attendu à la fermeture ne reflétera que les ventes
   * espèces de la session (fond inconnu, tracé comme tel — jamais supposé).
   */
  @ApiProperty({ required: false, description: 'Fond de caisse à l\'ouverture (centimes)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  openingCashMinorUnits?: number;
}
