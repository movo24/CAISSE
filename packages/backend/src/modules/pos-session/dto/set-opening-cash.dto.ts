import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Déclaration (ou correction manager) du fond de caisse d'une session.
 * Le montant est la seule valeur transmise ; l'attendu caisse le combine
 * côté serveur à la fermeture. Voir PosSessionService.setOpeningCash pour la
 * règle (déclaration caissier une fois, correction manager/admin auditée).
 */
export class SetOpeningCashDto {
  @ApiProperty({ description: 'Fond de caisse déclaré à l\'ouverture (centimes)' })
  @IsInt()
  @Min(0)
  openingCashMinorUnits: number;
}
