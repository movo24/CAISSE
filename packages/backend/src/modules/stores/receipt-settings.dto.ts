import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const RECEIPT_RECO_TARGETS = ['home', 'new', 'category'] as const;

/**
 * Réglages « Ticket de caisse » d'un magasin (Dashboard → Paramètres →
 * Magasins → Ticket de caisse). Patch partiel : seuls les champs fournis sont
 * modifiés ; chaque modification est auditée (ancienne/nouvelle valeur).
 */
export class UpdateReceiptSettingsDto {
  @ApiPropertyOptional({ description: 'Site Internet public (imprimé sur le ticket)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  websiteUrl?: string | null;

  @ApiPropertyOptional({ description: 'Logo officiel en data-URL image (PNG/JPEG), converti N&B à l’impression' })
  @IsOptional()
  @IsString()
  @Matches(/^data:image\/(png|jpe?g);base64,/, {
    message: 'receiptLogoUrl doit être une data-URL image (data:image/png;base64,… ou jpeg)',
  })
  @MaxLength(400_000, { message: 'Logo trop lourd (max ~300 Ko encodé)' })
  receiptLogoUrl?: string | null;

  @ApiPropertyOptional({ description: 'QR code du ticket numérique activé' })
  @IsOptional()
  @IsBoolean()
  receiptQrEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Texte court imprimé près du QR code' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  receiptQrText?: string | null;

  @ApiPropertyOptional({ description: 'Phrase personnalisée de fin de ticket' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  footerMessage?: string | null;

  @ApiPropertyOptional({ description: 'Formule de fin (ex. « Merci et à bientôt chez The Wesley »)' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  receiptFinalMessage?: string | null;

  @ApiPropertyOptional({ description: 'Zone recommandations/nouveautés sur la page numérique' })
  @IsOptional()
  @IsBoolean()
  receiptShowRecommendations?: boolean;

  @ApiPropertyOptional({ enum: RECEIPT_RECO_TARGETS, description: 'Destination commerciale : accueil, nouveautés ou catégorie' })
  @IsOptional()
  @IsIn(RECEIPT_RECO_TARGETS as unknown as string[])
  receiptRecommendationTarget?: string | null;

  @ApiPropertyOptional({ description: 'Catégorie ciblée quand la destination est « category »' })
  @IsOptional()
  @IsUUID()
  receiptRecommendationCategoryId?: string | null;

  @ApiPropertyOptional({ description: 'Base URL publique du ticket numérique (https://…)' })
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//, { message: 'receiptPublicBaseUrl doit commencer par http(s)://' })
  @MaxLength(255)
  receiptPublicBaseUrl?: string | null;
}

/** Champs de réglage ticket éditables via PUT /stores/:id/receipt-settings. */
export const RECEIPT_SETTINGS_FIELDS = [
  'websiteUrl',
  'receiptLogoUrl',
  'receiptQrEnabled',
  'receiptQrText',
  'footerMessage',
  'receiptFinalMessage',
  'receiptShowRecommendations',
  'receiptRecommendationTarget',
  'receiptRecommendationCategoryId',
  'receiptPublicBaseUrl',
] as const;

export type ReceiptSettingsField = (typeof RECEIPT_SETTINGS_FIELDS)[number];
