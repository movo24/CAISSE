import { IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for closing a POS session.
 *
 * The cash count is OPTIONAL: a session can be closed without counting (the
 * flow stays resilient, exactly as before). When `countedCashMinorUnits` is
 * provided, the backend derives the EXPECTED cash server-side (opening float +
 * cash sales bound to this session) and records the écart — the counted value
 * is the ONLY figure taken from the client; expected and écart are computed.
 */
export class CloseSessionDto {
  @ApiProperty({ required: false, description: 'Montant espèces compté physiquement à la fermeture (centimes)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  countedCashMinorUnits?: number;
}
