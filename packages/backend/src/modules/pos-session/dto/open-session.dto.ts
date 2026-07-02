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
   * P351 (POS-016) — fond de caisse déclaré à l'ouverture, en CENTIMES.
   * Optionnel (magasins sans procédure de float) ; entier ≥ 0.
   */
  @ApiProperty({ required: false, description: 'Fond de caisse en centimes (entier ≥ 0)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  openingFloatMinorUnits?: number | null;
}
